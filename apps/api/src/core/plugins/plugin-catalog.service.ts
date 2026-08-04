import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PluginManifest } from "@constellation/plugin-sdk";
import { PluginLoaderService } from "./plugin-loader.service.js";
import { PluginRegistryService } from "./plugin-registry.service.js";

/** A catalog entry = the metadata of a SHIPPED plugin that is NOT yet installed. */
export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  toolCount: number;
  /** Absolute path of the bundled plugin folder inside the catalog root. */
  dir: string;
}

/** Marker file written into an installed plugin's folder by `install()`. */
export const INSTALL_MARKER = ".constellation-installed.json";

/**
 * Phase 3.0 — PLUGIN MARKETPLACE (local-first).
 *
 * The repo ships a `plugins-catalog/` folder of bundled-but-not-yet-installed
 * plugins. This service lists the catalog (browse), installs an entry by
 * copying it into the plugins dir + writing an install marker, and uninstalls
 * (marker-gated: only catalog-installed plugins can be uninstalled — a
 * hand-placed plugin in `plugins/` is NEVER removed). After every mutation the
 * loader `reload()`s, so the change takes effect without a restart.
 *
 * Directory resolution mirrors the loader (repo-root relative), with the
 * catalog root configurable via PLUGINS_CATALOG_DIR (default "plugins-catalog").
 */
@Injectable()
export class PluginCatalogService {
  private readonly logger = new Logger(PluginCatalogService.name);

  constructor(
    private readonly loader: PluginLoaderService,
    private readonly registry: PluginRegistryService,
  ) {}

  /** The catalog root (repo-relative PLUGINS_CATALOG_DIR, default "plugins-catalog"). */
  catalogRoot(): string {
    const configured = process.env.PLUGINS_CATALOG_DIR ?? "plugins-catalog";
    // Same resolution rule as the loader: absolute paths pass through,
    // relative ones resolve against the monorepo root (cwd of the app dir).
    if (resolve(configured) === configured) return configured;
    const fromRepoRoot = resolve(process.cwd(), "..", "..", configured);
    if (existsSync(fromRepoRoot)) return fromRepoRoot;
    return resolve(process.cwd(), configured);
  }

  /** Every bundled catalog entry (the marketplace's "available" pool). */
  entries(): CatalogEntry[] {
    const root = this.catalogRoot();
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .map((name) => join(root, name))
      .filter((p) => {
        try {
          return statSync(p).isDirectory() && existsSync(join(p, "plugin.manifest.json"));
        } catch {
          return false;
        }
      })
      .map((dir) => {
        const manifest = JSON.parse(readFileSync(join(dir, "plugin.manifest.json"), "utf8")) as PluginManifest;
        return {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
          permissions: manifest.permissions ?? [],
          toolCount: (manifest.tools ?? []).length,
          dir,
        };
      });
  }

  /** Catalog entries that are NOT installed yet (the browseable marketplace). */
  available(): CatalogEntry[] {
    const installedIds = new Set(this.registry.all().map((p) => p.manifest.id));
    return this.entries().filter((e) => !installedIds.has(e.id));
  }

  /** True when a plugin was installed via the catalog (marker file present). */
  isCatalogInstalled(id: string): boolean {
    try {
      const dir = join(this.loader.getPluginsRoot(), id);
      return existsSync(dir) && existsSync(join(dir, INSTALL_MARKER));
    } catch {
      return false;
    }
  }

  /** Copy a catalog entry into the plugins dir and reload the registry. */
  async install(id: string): Promise<CatalogEntry> {
    const entry = this.entries().find((e) => e.id === id);
    if (!entry) throw new NotFoundException(`Plugin "${id}" is not in the catalog`);
    const target = join(this.loader.getPluginsRoot(), id);
    if (existsSync(target)) {
      throw new ConflictException(`Plugin "${id}" is already installed`);
    }
    mkdirSync(this.loader.getPluginsRoot(), { recursive: true });
    cpSync(entry.dir, target, { recursive: true });
    writeFileSync(
      join(target, INSTALL_MARKER),
      JSON.stringify({ installedAt: new Date().toISOString(), fromCatalog: id }, null, 2),
    );
    await this.loader.reload();
    this.logger.log(`Installed plugin "${id}" from the catalog`);
    return entry;
  }

  /** Remove a CATALOG-installed plugin's folder and reload. Refuses anything else. */
  async uninstall(id: string): Promise<void> {
    if (!this.isCatalogInstalled(id)) {
      throw new BadRequestException(
        `Plugin "${id}" was not installed from the catalog — refusing to remove it`,
      );
    }
    rmSync(join(this.loader.getPluginsRoot(), id), { recursive: true, force: true });
    await this.loader.reload();
    this.logger.log(`Uninstalled plugin "${id}"`);
  }
}
