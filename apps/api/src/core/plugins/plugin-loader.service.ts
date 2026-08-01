import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Injectable, Logger, Optional, type OnModuleInit } from "@nestjs/common";
import {
  PLATFORM_VERSION,
  safeParseManifest,
  type LoadedPlugin,
  type Plugin,
  type PluginManifest,
} from "@constellation/plugin-sdk";
import { EventBusService } from "../events/event-bus.service.js";
import { buildContextWith, PluginContextFactory } from "./plugin-context.factory.js";
import { PluginLifecycleService } from "./plugin-lifecycle.service.js";
import { PluginRegistryService } from "./plugin-registry.service.js";

type EntryImporter = (specifier: string) => Promise<{ default?: Plugin }>;

/**
 * A true ESM dynamic import that survives TypeScript's CommonJS downleveling.
 * Under `module: CommonJS`, tsc rewrites `import()` to `require()`, which cannot
 * load an ESM plugin or a file:// URL. The Function constructor hides the
 * import from the transpiler so a real dynamic import reaches Node.
 */
const esmImport: EntryImporter = new Function("specifier", "return import(specifier)") as EntryImporter;

/**
 * Test-only seam. `new Function(...)`-constructed dynamic import (required in
 * production, see `esmImport` above) throws `"A dynamic import callback was
 * not specified"` when executed inside Vitest's vm-transformed module context
 * — a Vitest/vite-node limitation, not a bug in the trick itself (it works
 * fine under plain `node`, which is what actually ships; see
 * MASTER_PLAN.md §9). A literal `import()` of an absolute file:// URL outside
 * the Vite project root also fails under vite-node's SSR resolver on Windows,
 * so tests swap in a fake importer instead (see plugin-loader.test.ts) rather
 * than exercising the real ESM-loading mechanism. Production code must never
 * call this.
 */
let entryImporter: EntryImporter = esmImport;
export function __setEntryImporterForTests(fn: EntryImporter | undefined): void {
  entryImporter = fn ?? esmImport;
}

interface ManifestEntry {
  manifest: PluginManifest;
  dir: string;
}

/** One id's place in load order, plus why it's blocked if it can't proceed. */
interface OrderedEntry {
  id: string;
  blockedReason?: string;
}

/**
 * Discovers plugins on boot and drives their early lifecycle.
 *
 * Discovery is filesystem-based today: every immediate subdirectory of
 * PLUGINS_DIR that contains a valid `plugin.manifest.json` is a plugin. This is
 * how "drop a repo in, it becomes a module" works with zero core edits. The
 * same interface later backs a DB-driven / marketplace-driven catalog.
 *
 * Isolation is the rule: one bad plugin (invalid manifest, throwing entry,
 * version mismatch, missing/cyclic dependency) is marked `failed` and skipped
 * — it never takes down the core or the other plugins. Plugins are loaded in
 * topological order of `manifest.dependencies`; a plugin whose dependency is
 * missing, cyclic, or itself failed is marked `failed` too (cascading), with
 * an error naming the root cause.
 */
@Injectable()
export class PluginLoaderService implements OnModuleInit {
  private readonly logger = new Logger(PluginLoaderService.name);

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly lifecycle: PluginLifecycleService,
    @Optional() private readonly contextFactory?: PluginContextFactory,
    // @Optional() for the same reason as contextFactory: the offline unit
    // tests hand-wire these services with `new` and no DI container, so no
    // event bus is present there. Publishing must degrade to a no-op, never
    // throw. See INTEGRATION_NOTES_ATLAS.md §4.
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /** Publish a platform lifecycle event; a no-op when no bus is wired (offline tests). */
  private emit(topic: string, manifest: PluginManifest, extra: Record<string, unknown> = {}): void {
    this.eventBus?.emitPlatform(topic, { pluginId: manifest.id, version: manifest.version, ...extra });
  }

  async onModuleInit(): Promise<void> {
    const dir = this.pluginsDir();
    if (!existsSync(dir)) {
      this.logger.warn(`Plugins directory not found: ${dir} — no plugins loaded`);
      return;
    }
    this.logger.log(`Scanning for plugins in ${dir}`);

    const manifests = this.readManifests(this.pluginDirs(dir));
    const order = resolveLoadOrder(manifests);

    const failedIds = new Set<string>();
    for (const item of order) {
      const entry = manifests.get(item.id);
      /* istanbul ignore next -- resolveLoadOrder only emits ids present in `manifests` */
      if (!entry) continue;

      if (item.blockedReason) {
        failedIds.add(item.id);
        this.registerFailed(entry, item.blockedReason);
        continue;
      }

      const failedDep = entry.manifest.dependencies.find((d) => failedIds.has(d));
      if (failedDep) {
        failedIds.add(item.id);
        this.registerFailed(entry, `depends on failed plugin "${failedDep}"`);
        continue;
      }

      const ok = await this.loadOne(entry.manifest, entry.dir);
      if (!ok) failedIds.add(item.id);
    }

    // Boot-time default: enable everything that registered cleanly. Persisted
    // per-plugin enable/disable state (from the DB) supersedes this once
    // Atlas's settings/database core lands — see PluginLifecycleService.
    await this.lifecycle.enableAllRegistered();

    const ok = this.registry.byState("enabled").length + this.registry.byState("registered").length;
    const failed = this.registry.byState("failed").length;
    this.logger.log(`Plugin load complete: ${ok} ok, ${failed} failed, ${this.registry.count()} total`);
  }

  /** Resolve PLUGINS_DIR relative to the monorepo root (two up from apps/api). */
  private pluginsDir(): string {
    const configured = process.env.PLUGINS_DIR ?? "plugins";
    // dist/main.js runs from apps/api/dist, so repo root is three up; in dev
    // (ts) it's two up. Resolve against cwd which is the app dir under turbo.
    // (If `configured` is already absolute — e.g. a test fixture dir — resolve
    // returns it as-is, ignoring the earlier segments.)
    const fromRepoRoot = resolve(process.cwd(), "..", "..", configured);
    if (existsSync(fromRepoRoot)) return fromRepoRoot;
    return resolve(process.cwd(), configured);
  }

  private pluginDirs(root: string): string[] {
    return readdirSync(root)
      .map((name) => join(root, name))
      .filter((p) => {
        try {
          return statSync(p).isDirectory() && existsSync(join(p, "plugin.manifest.json"));
        } catch {
          return false;
        }
      });
  }

  /** Phase 1: read + validate every manifest, without importing any runtime code. */
  private readManifests(dirs: string[]): Map<string, ManifestEntry> {
    const manifests = new Map<string, ManifestEntry>();
    for (const pluginDir of dirs) {
      const manifestPath = join(pluginDir, "plugin.manifest.json");
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch (err) {
        this.logger.error(`Unreadable manifest at ${manifestPath}: ${asMessage(err)}`);
        continue;
      }

      const parsed = safeParseManifest(raw);
      if (!parsed.success) {
        this.logger.error(
          `Invalid manifest at ${manifestPath}: ${parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
        continue;
      }

      const manifest = parsed.data;
      const existing = manifests.get(manifest.id);
      if (existing) {
        this.logger.error(
          `Duplicate plugin id "${manifest.id}" at ${pluginDir} — already found at ${existing.dir}, skipping`,
        );
        continue;
      }
      manifests.set(manifest.id, { manifest, dir: pluginDir });
    }
    return manifests;
  }

  private registerFailed(entry: ManifestEntry, error: string): void {
    const loaded: LoadedPlugin = {
      manifest: entry.manifest,
      runtime: {},
      state: "failed",
      dir: entry.dir,
      error,
    };
    this.registry.register(loaded);
    this.emit("plugin:failed", entry.manifest, { error });
    this.logger.error(`Plugin "${entry.manifest.id}" skipped: ${error}`);
  }

  /** Phase 2: platform-version check, runtime import, and register() — for one already-ordered plugin. */
  private async loadOne(manifest: PluginManifest, pluginDir: string): Promise<boolean> {
    if (!this.satisfiesPlatform(manifest.minPlatformVersion)) {
      this.registerFailed(
        { manifest, dir: pluginDir },
        `requires platform >= ${manifest.minPlatformVersion}, running ${PLATFORM_VERSION}`,
      );
      return false;
    }

    // Load the runtime entry (best-effort: a plugin can be manifest-only for now).
    let runtime: Plugin = {};
    const entryPath = join(pluginDir, manifest.entry);
    if (existsSync(entryPath)) {
      try {
        const mod = await entryImporter(pathToFileURL(resolve(entryPath)).href);
        runtime = mod.default ?? {};
      } catch (err) {
        this.registerFailed({ manifest, dir: pluginDir }, `entry failed to import: ${asMessage(err)}`);
        return false;
      }
    } else {
      this.logger.warn(`Plugin "${manifest.id}" has no built entry at ${manifest.entry} (manifest-only)`);
    }

    const loaded: LoadedPlugin = { manifest, runtime, state: "validated", dir: pluginDir };
    this.registry.register(loaded);

    // register() hook — isolated so a throw only fails this plugin.
    try {
      await runtime.register?.(await buildContextWith(this.contextFactory, manifest));
      this.registry.setState(manifest.id, "registered");
      this.emit("plugin:registered", manifest, { tools: manifest.tools.map((t) => t.name) });
      this.logger.log(`Registered plugin "${manifest.id}" v${manifest.version}`);
      return true;
    } catch (err) {
      const error = `register() threw: ${asMessage(err)}`;
      this.registry.setState(manifest.id, "failed", error);
      this.emit("plugin:failed", manifest, { error });
      this.logger.error(`Plugin "${manifest.id}" register() failed: ${asMessage(err)}`);
      return false;
    }
  }

  /** Minimal semver-major/minor/patch >= comparison. */
  private satisfiesPlatform(min: string): boolean {
    const a = min.split(".").map((n) => parseInt(n, 10));
    const b = PLATFORM_VERSION.split(".").map((n) => parseInt(n, 10));
    for (let i = 0; i < 3; i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      if (bv > av) return true;
      if (bv < av) return false;
    }
    return true;
  }
}

/**
 * Topologically sort manifests by `dependencies` (dependency before dependent)
 * via DFS. Returns every id exactly once, in an order safe to load — entries
 * that can't be safely loaded carry a `blockedReason` (missing dependency or
 * a cycle) instead of being omitted, so the caller can still register them as
 * `failed` with a clear error rather than silently dropping them.
 */
function resolveLoadOrder(manifests: Map<string, ManifestEntry>): OrderedEntry[] {
  const ids = [...manifests.keys()].sort();
  const result: OrderedEntry[] = [];
  const done = new Set<string>();
  const blockedReasons = new Map<string, string[]>();

  const addBlocked = (id: string, reason: string) => {
    const list = blockedReasons.get(id) ?? [];
    list.push(reason);
    blockedReasons.set(id, list);
  };

  const visit = (id: string, stack: string[]): void => {
    if (done.has(id)) return;
    if (stack.includes(id)) {
      const cycleStart = stack.indexOf(id);
      const cyclePath = [...stack.slice(cycleStart), id].join(" -> ");
      for (const cid of stack.slice(cycleStart)) {
        addBlocked(cid, `circular dependency: ${cyclePath}`);
      }
      return;
    }

    const entry = manifests.get(id);
    /* istanbul ignore next -- ids always come from manifests.keys() */
    if (!entry) return;

    stack.push(id);
    for (const depId of [...entry.manifest.dependencies].sort()) {
      if (!manifests.has(depId)) {
        addBlocked(id, `missing dependency "${depId}"`);
        continue;
      }
      visit(depId, stack);
      const depBlocked = blockedReasons.has(depId) && !stack.includes(depId);
      const alreadyCyclic = blockedReasons.get(id)?.some((r) => r.startsWith("circular dependency"));
      if (depBlocked && !alreadyCyclic) {
        addBlocked(id, `depends on failed plugin "${depId}"`);
      }
    }
    stack.pop();

    if (!done.has(id)) {
      done.add(id);
      const reasons = blockedReasons.get(id);
      result.push({ id, blockedReason: reasons?.join("; ") });
    }
  };

  for (const id of ids) visit(id, []);
  return result;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
