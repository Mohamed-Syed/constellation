import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginCatalogService, INSTALL_MARKER } from "./plugin-catalog.service.js";
import { PluginRegistryService } from "./plugin-registry.service.js";

/**
 * Phase 3.0 — plugin marketplace: catalog listing + install/uninstall.
 * Uses REAL tmp dirs + a stubbed loader (reload spy) so the fs contract is
 * exercised without touching the repo's actual plugins/ folders.
 */
describe("PluginCatalogService", () => {
  let catalogRoot: string;
  let pluginsRoot: string;
  let loader: { getPluginsRoot: () => string; reload: ReturnType<typeof vi.fn> };
  let registry: PluginRegistryService;
  let svc: PluginCatalogService;

  beforeEach(() => {
    catalogRoot = join(tmpdir(), `cat-${Math.random().toString(36).slice(2)}`);
    pluginsRoot = join(tmpdir(), `plg-${Math.random().toString(36).slice(2)}`);
    mkdirSync(catalogRoot, { recursive: true });
    mkdirSync(pluginsRoot, { recursive: true });
    // A bundled catalog plugin (mirrors plugins-catalog/hello-catalog).
    mkdirSync(join(catalogRoot, "hello-catalog", "dist"), { recursive: true });
    writeFileSync(
      join(catalogRoot, "hello-catalog", "plugin.manifest.json"),
      JSON.stringify({
        manifestVersion: 2,
        id: "hello-catalog",
        name: "Hello Catalog",
        version: "0.1.0",
        description: "demo",
        permissions: ["hello-catalog:greet:read"],
        entry: "dist/index.js",
      }),
    );
    writeFileSync(join(catalogRoot, "hello-catalog", "dist", "index.js"), "export default {};\n");
    // A non-plugin directory must be ignored.
    mkdirSync(join(catalogRoot, "not-a-plugin"));
    process.env.PLUGINS_CATALOG_DIR = catalogRoot;
    process.env.PLUGINS_DIR = pluginsRoot;
    loader = {
      getPluginsRoot: () => pluginsRoot,
      reload: vi.fn().mockResolvedValue(undefined),
    };
    registry = new PluginRegistryService();
    svc = new PluginCatalogService(loader as never, registry);
  });

  afterEach(() => {
    delete process.env.PLUGINS_CATALOG_DIR;
    delete process.env.PLUGINS_DIR;
  });

  it("lists catalog entries from manifest metadata (ignores non-plugin dirs)", () => {
    const entries = svc.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "hello-catalog",
      name: "Hello Catalog",
      version: "0.1.0",
      toolCount: 0,
      permissions: ["hello-catalog:greet:read"],
    });
  });

  it("available() excludes already-installed ids", () => {
    registry.register({
      manifest: {
        id: "hello-catalog",
        name: "Hello Catalog",
        version: "0.1.0",
        description: "demo",
        permissions: [],
        tools: [],
        navigation: [],
        routes: [],
        settings: [],
        featureFlags: [],
        dependencies: [],
        requiredServices: [],
        entry: "dist/index.js",
        minPlatformVersion: "0.1.0",
      },
      state: "enabled",
      dir: pluginsRoot,
    } as never);
    expect(svc.available()).toHaveLength(0);
  });

  it("install() copies the bundle, writes the marker, and reloads", async () => {
    await svc.install("hello-catalog");
    const target = join(pluginsRoot, "hello-catalog");
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(target, INSTALL_MARKER))).toBe(true);
    expect(loader.reload).toHaveBeenCalledTimes(1);
    expect(svc.isCatalogInstalled("hello-catalog")).toBe(true);
  });

  it("install() throws 404 for an unknown catalog id", async () => {
    await expect(svc.install("nope")).rejects.toMatchObject({ status: 404 });
    expect(loader.reload).not.toHaveBeenCalled();
  });

  it("install() throws 409 when the target folder already exists", async () => {
    mkdirSync(join(pluginsRoot, "hello-catalog"));
    await expect(svc.install("hello-catalog")).rejects.toMatchObject({ status: 409 });
  });

  it("uninstall() removes a catalog-installed plugin and reloads", async () => {
    await svc.install("hello-catalog");
    await svc.uninstall("hello-catalog");
    expect(existsSync(join(pluginsRoot, "hello-catalog"))).toBe(false);
    expect(loader.reload).toHaveBeenCalledTimes(2);
  });

  it("uninstall() refuses plugins that were NOT installed from the catalog", async () => {
    // Hand-placed plugin (no marker) — must never be removed.
    mkdirSync(join(pluginsRoot, "hand-made"));
    writeFileSync(join(pluginsRoot, "hand-made", "plugin.manifest.json"), "{}");
    await expect(svc.uninstall("hand-made")).rejects.toMatchObject({ status: 400 });
    expect(existsSync(join(pluginsRoot, "hand-made"))).toBe(true);
  });

  it("catalogRoot() honours the PLUGINS_CATALOG_DIR override", () => {
    expect(svc.catalogRoot()).toBe(catalogRoot);
  });

  it("entries() returns [] when the catalog dir is missing", () => {
    process.env.PLUGINS_CATALOG_DIR = join(tmpdir(), "does-not-exist-xyz");
    expect(svc.entries()).toEqual([]);
  });

  it("isCatalogInstalled() is false for a bare hand-placed plugin", () => {
    mkdirSync(join(pluginsRoot, "hand-made"));
    writeFileSync(join(pluginsRoot, "hand-made", "plugin.manifest.json"), "{}");
    expect(svc.isCatalogInstalled("hand-made")).toBe(false);
  });

  it("uninstall() of an unknown id is a clean 400 (no marker)", async () => {
    await expect(svc.uninstall("ghost")).rejects.toMatchObject({ status: 400 });
  });
});
