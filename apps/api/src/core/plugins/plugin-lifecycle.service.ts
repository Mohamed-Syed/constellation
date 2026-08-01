import { Injectable, Logger, Optional } from "@nestjs/common";
import type { PluginManifest } from "@constellation/plugin-sdk";
import { PrismaService } from "../database/prisma.service.js";
import { EventBusService } from "../events/event-bus.service.js";
import { buildContextWith, PluginContextFactory } from "./plugin-context.factory.js";
import { PluginRegistryService } from "./plugin-registry.service.js";

/**
 * Owns the enable/disable state transitions. Each hook call is isolated: a
 * throwing `enable()`/`disable()` marks that plugin `failed` with a clear
 * error and never takes down the core or other plugins.
 *
 * Persistence: every successful (and failed) transition is mirrored to the
 * `PluginInstallation` row for that plugin (id/version/state/enabled) via
 * `PrismaService`, no-op-with-warn when there's no database — see
 * `persistInstallation()`. `enableAllRegistered()` reads that table on boot
 * so a plugin an admin explicitly disabled stays disabled across a restart,
 * falling back to "enable everything" when there's no database at all.
 */
@Injectable()
export class PluginLifecycleService {
  private readonly logger = new Logger(PluginLifecycleService.name);

  constructor(
    private readonly registry: PluginRegistryService,
    @Optional() private readonly contextFactory?: PluginContextFactory,
    // @Optional() like contextFactory — the offline unit tests construct this
    // service by hand with no DI container. Event publishing degrades to a
    // no-op there rather than throwing. See INTEGRATION_NOTES_ATLAS.md §4.
    @Optional() private readonly eventBus?: EventBusService,
    // @Optional() for the same reason — hand-wired tests pass no PrismaService,
    // so persistence degrades to a no-op (matches PrismaService's own "boot
    // with no DB" invariant; see prisma.service.ts).
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /** Publish a platform lifecycle event; a no-op when no bus is wired (offline tests). */
  private emit(topic: string, manifest: PluginManifest, extra: Record<string, unknown> = {}): void {
    this.eventBus?.emitPlatform(topic, { pluginId: manifest.id, version: manifest.version, ...extra });
  }

  /**
   * Upsert the durable `PluginInstallation` row for a plugin. No-op-with-warn
   * when there's no database (`prisma.db` is `undefined`) or the write fails
   * — persistence is best-effort and must never take the in-memory registry
   * (the real source of truth for a running process) down with it.
   */
  private async persistInstallation(manifest: PluginManifest, state: string, enabled: boolean): Promise<void> {
    const db = this.prisma?.db;
    if (!db) return;
    try {
      await db.pluginInstallation.upsert({
        where: { pluginId: manifest.id },
        create: { pluginId: manifest.id, version: manifest.version, state, enabled },
        update: { version: manifest.version, state, enabled },
      });
    } catch (err) {
      this.logger.warn(`Failed to persist installation state for plugin "${manifest.id}": ${asMessage(err)}`);
    }
  }

  async enable(id: string): Promise<void> {
    const p = this.registry.get(id);
    if (!p) {
      this.logger.warn(`Cannot enable unknown plugin "${id}"`);
      return;
    }
    if (p.state === "failed") {
      this.logger.warn(`Refusing to enable failed plugin "${id}": ${p.error ?? "unknown error"}`);
      return;
    }
    if (p.state === "enabled") return; // idempotent

    try {
      await p.runtime.enable?.(await buildContextWith(this.contextFactory, p.manifest));
      this.registry.setState(id, "enabled");
      this.emit("plugin:enabled", p.manifest);
      await this.persistInstallation(p.manifest, "enabled", true);
      this.logger.log(`Enabled plugin "${id}"`);
    } catch (err) {
      const error = `enable() threw: ${asMessage(err)}`;
      this.registry.setState(id, "failed", error);
      this.emit("plugin:failed", p.manifest, { error });
      // Persist the admin's *intent* (enabled) alongside the actual failed
      // state, so a boot retry attempts enable() again rather than silently
      // staying disabled forever because of one transient failure.
      await this.persistInstallation(p.manifest, "failed", true);
      this.logger.error(`Plugin "${id}" enable() failed: ${asMessage(err)}`);
    }
  }

  async disable(id: string): Promise<void> {
    const p = this.registry.get(id);
    if (!p) {
      this.logger.warn(`Cannot disable unknown plugin "${id}"`);
      return;
    }
    if (p.state === "disabled") return; // idempotent
    if (p.state !== "enabled") {
      this.logger.warn(`Cannot disable plugin "${id}" in state "${p.state}"`);
      return;
    }

    try {
      await p.runtime.disable?.(await buildContextWith(this.contextFactory, p.manifest));
      this.registry.setState(id, "disabled");
      this.emit("plugin:disabled", p.manifest);
      await this.persistInstallation(p.manifest, "disabled", false);
      this.logger.log(`Disabled plugin "${id}"`);
    } catch (err) {
      const error = `disable() threw: ${asMessage(err)}`;
      this.registry.setState(id, "failed", error);
      this.emit("plugin:failed", p.manifest, { error });
      // Intent was "disabled" — persist that so a boot retry doesn't
      // resurrect a plugin whose disable() hook failed mid-teardown.
      await this.persistInstallation(p.manifest, "failed", false);
      this.logger.error(`Plugin "${id}" disable() failed: ${asMessage(err)}`);
    }
  }

  /**
   * Boot-time default. With no database (or an empty/unreadable
   * `PluginInstallation` table), falls back to the original behavior:
   * enable every plugin that registered successfully.
   *
   * With a database, each registered plugin's persisted `enabled` flag
   * decides its fate: `true` (or no row yet — a newly-added plugin) enables
   * it as before; `false` leaves it `disabled` in the registry WITHOUT
   * calling the runtime's `enable()`/`disable()` hooks — nothing ran this
   * boot, so there is nothing to tear down. Either way the row is
   * (re-)upserted so `PluginInstallation` always reflects every loaded
   * plugin's current id/version/state.
   */
  async enableAllRegistered(): Promise<void> {
    const registered = this.registry.byState("registered");
    const persisted = await this.loadPersistedEnabledFlags();

    for (const p of registered) {
      const record = persisted?.get(p.manifest.id);
      const shouldEnable = !persisted || record === undefined || record;
      if (shouldEnable) {
        await this.enable(p.manifest.id);
        continue;
      }
      this.registry.setState(p.manifest.id, "disabled");
      this.emit("plugin:disabled", p.manifest);
      await this.persistInstallation(p.manifest, "disabled", false);
      this.logger.log(`Plugin "${p.manifest.id}" left disabled (persisted state)`);
    }
  }

  /**
   * Read every `PluginInstallation.enabled` flag keyed by `pluginId`.
   * Returns `undefined` (rather than an empty map) when there's no database
   * or the read fails, so the caller can tell "no persisted state, fall
   * back to enable-all" apart from "persisted state says nothing is enabled".
   */
  private async loadPersistedEnabledFlags(): Promise<Map<string, boolean> | undefined> {
    const db = this.prisma?.db;
    if (!db) return undefined;
    try {
      const rows = await db.pluginInstallation.findMany({ select: { pluginId: true, enabled: true } });
      return new Map(rows.map((r) => [r.pluginId, r.enabled]));
    } catch (err) {
      this.logger.warn(
        `Failed to read persisted plugin installation state, defaulting to enable-all: ${asMessage(err)}`,
      );
      return undefined;
    }
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
