import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  PLATFORM_VERSION,
  safeParseManifest,
  type LoadedPlugin,
  type Plugin,
} from "@constellation/plugin-sdk";
import { PluginRegistryService } from "./plugin-registry.service.js";

/**
 * A true ESM dynamic import that survives TypeScript's CommonJS downleveling.
 * Under `module: CommonJS`, tsc rewrites `import()` to `require()`, which cannot
 * load an ESM plugin or a file:// URL. The Function constructor hides the
 * import from the transpiler so a real dynamic import reaches Node.
 */
const esmImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<{ default?: Plugin }>;

/**
 * Discovers plugins on boot and drives their early lifecycle.
 *
 * Discovery is filesystem-based today: every immediate subdirectory of
 * PLUGINS_DIR that contains a valid `plugin.manifest.json` is a plugin. This is
 * how "drop a repo in, it becomes a module" works with zero core edits. The
 * same interface later backs a DB-driven / marketplace-driven catalog.
 *
 * Isolation is the rule: one bad plugin (invalid manifest, throwing entry,
 * version mismatch) is marked `failed` and skipped — it never takes down the
 * core or the other plugins.
 */
@Injectable()
export class PluginLoaderService implements OnModuleInit {
  private readonly logger = new Logger(PluginLoaderService.name);

  constructor(private readonly registry: PluginRegistryService) {}

  async onModuleInit(): Promise<void> {
    const dir = this.pluginsDir();
    if (!existsSync(dir)) {
      this.logger.warn(`Plugins directory not found: ${dir} — no plugins loaded`);
      return;
    }
    this.logger.log(`Scanning for plugins in ${dir}`);
    for (const entry of this.pluginDirs(dir)) {
      await this.loadOne(entry);
    }
    const ok = this.registry.byState("registered").length + this.registry.byState("enabled").length;
    const failed = this.registry.byState("failed").length;
    this.logger.log(`Plugin load complete: ${ok} ok, ${failed} failed, ${this.registry.count()} total`);
  }

  /** Resolve PLUGINS_DIR relative to the monorepo root (two up from apps/api). */
  private pluginsDir(): string {
    const configured = process.env.PLUGINS_DIR ?? "plugins";
    // dist/main.js runs from apps/api/dist, so repo root is three up; in dev
    // (ts) it's two up. Resolve against cwd which is the app dir under turbo.
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

  private async loadOne(pluginDir: string): Promise<void> {
    const manifestPath = join(pluginDir, "plugin.manifest.json");
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (err) {
      this.logger.error(`Unreadable manifest at ${manifestPath}: ${asMessage(err)}`);
      return;
    }

    const parsed = safeParseManifest(raw);
    if (!parsed.success) {
      this.logger.error(
        `Invalid manifest at ${manifestPath}: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
      return;
    }
    const manifest = parsed.data;

    if (!this.satisfiesPlatform(manifest.minPlatformVersion)) {
      const loaded: LoadedPlugin = {
        manifest,
        runtime: {},
        state: "failed",
        dir: pluginDir,
        error: `requires platform >= ${manifest.minPlatformVersion}, running ${PLATFORM_VERSION}`,
      };
      this.registry.register(loaded);
      this.logger.error(`Plugin "${manifest.id}" skipped: ${loaded.error}`);
      return;
    }

    // Load the runtime entry (best-effort: a plugin can be manifest-only for now).
    let runtime: Plugin = {};
    const entryPath = join(pluginDir, manifest.entry);
    if (existsSync(entryPath)) {
      try {
        const mod = await esmImport(pathToFileURL(resolve(entryPath)).href);
        runtime = mod.default ?? {};
      } catch (err) {
        const loaded: LoadedPlugin = {
          manifest,
          runtime: {},
          state: "failed",
          dir: pluginDir,
          error: `entry failed to import: ${asMessage(err)}`,
        };
        this.registry.register(loaded);
        this.logger.error(`Plugin "${manifest.id}" entry error: ${loaded.error}`);
        return;
      }
    } else {
      this.logger.warn(`Plugin "${manifest.id}" has no built entry at ${manifest.entry} (manifest-only)`);
    }

    const loaded: LoadedPlugin = { manifest, runtime, state: "validated", dir: pluginDir };
    this.registry.register(loaded);

    // register() hook — isolated so a throw only fails this plugin.
    try {
      await runtime.register?.(this.buildContext(manifest.id));
      this.registry.setState(manifest.id, "registered");
      this.logger.log(`Registered plugin "${manifest.id}" v${manifest.version}`);
    } catch (err) {
      this.registry.setState(manifest.id, "failed", `register() threw: ${asMessage(err)}`);
      this.logger.error(`Plugin "${manifest.id}" register() failed: ${asMessage(err)}`);
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

  /**
   * Build the capability object handed to a plugin. This is a minimal stub for
   * the foundation; the real logger/config/events/db are injected once those
   * core services land (Atlas/Nova workstreams). Kept here so the lifecycle is
   * exercised end-to-end from day one.
   */
  private buildContext(pluginId: string) {
    const logger = new Logger(`plugin:${pluginId}`);
    return {
      pluginId,
      logger: {
        debug: (m: string) => logger.debug(m),
        info: (m: string) => logger.log(m),
        warn: (m: string) => logger.warn(m),
        error: (m: string) => logger.error(m),
        child: () => this.buildContext(pluginId).logger,
      },
      config: {
        get: () => undefined,
        getOrThrow: () => {
          throw new Error("config not available in foundation build");
        },
        isFeatureEnabled: () => false,
      },
      events: {
        emit: () => undefined,
        on: () => undefined,
        onPlatform: () => undefined,
      },
      getPrincipal: () => undefined,
    };
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
