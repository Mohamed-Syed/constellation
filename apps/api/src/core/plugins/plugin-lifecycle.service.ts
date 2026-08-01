import { Injectable, Logger, Optional } from "@nestjs/common";
import type { PluginManifest } from "@constellation/plugin-sdk";
import { EventBusService } from "../events/event-bus.service.js";
import { buildContextWith, PluginContextFactory } from "./plugin-context.factory.js";
import { PluginRegistryService } from "./plugin-registry.service.js";

/**
 * Owns the enable/disable state transitions. Each hook call is isolated: a
 * throwing `enable()`/`disable()` marks that plugin `failed` with a clear
 * error and never takes down the core or other plugins.
 *
 * Persistence seam: today "enabled" state lives only in the in-memory
 * registry and is recomputed fresh every boot (auto-enable everything that
 * registered successfully). Once Atlas's settings/database core lands, boot
 * should instead read persisted per-plugin enabled/disabled state from the DB
 * and call `enable()`/`disable()` to match it, rather than blindly enabling
 * everything — `enableAllRegistered()` below is the call site to replace.
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
  ) {}

  /** Publish a platform lifecycle event; a no-op when no bus is wired (offline tests). */
  private emit(topic: string, manifest: PluginManifest, extra: Record<string, unknown> = {}): void {
    this.eventBus?.emitPlatform(topic, { pluginId: manifest.id, version: manifest.version, ...extra });
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
      this.logger.log(`Enabled plugin "${id}"`);
    } catch (err) {
      const error = `enable() threw: ${asMessage(err)}`;
      this.registry.setState(id, "failed", error);
      this.emit("plugin:failed", p.manifest, { error });
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
      this.logger.log(`Disabled plugin "${id}"`);
    } catch (err) {
      const error = `disable() threw: ${asMessage(err)}`;
      this.registry.setState(id, "failed", error);
      this.emit("plugin:failed", p.manifest, { error });
      this.logger.error(`Plugin "${id}" disable() failed: ${asMessage(err)}`);
    }
  }

  /** Boot-time default: enable every plugin that registered successfully. */
  async enableAllRegistered(): Promise<void> {
    for (const p of this.registry.byState("registered")) {
      await this.enable(p.manifest.id);
    }
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
