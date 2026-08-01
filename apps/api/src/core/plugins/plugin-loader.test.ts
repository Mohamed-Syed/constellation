import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { HealthResult, Plugin, PluginContext } from "@constellation/plugin-sdk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventBusService } from "../events/event-bus.service.js";
import { PluginHealthService } from "./plugin-health.service.js";
import { PluginLifecycleService } from "./plugin-lifecycle.service.js";
import { __setEntryImporterForTests, PluginLoaderService } from "./plugin-loader.service.js";
import { PluginRegistryService } from "./plugin-registry.service.js";

/**
 * Offline loader test: no NestJS DI container, no real HTTP boot. Services
 * are plain classes — wire them by hand with `new` and drive them directly.
 * Fixture plugins live under a fresh mkdtemp dir per test and are pointed at
 * via PLUGINS_DIR (which `pluginsDir()` treats as absolute and uses as-is).
 *
 * Manifests are real files on disk (exercising the real JSON-read + Zod
 * validation path). Runtime *entries* are NOT real ESM files: the loader's
 * production entry-import mechanism (`new Function("s","return import(s)")`,
 * required so tsc's CJS downleveling can't rewrite it to `require()`) doesn't
 * work inside Vitest's vm-transformed module context (throws "A dynamic
 * import callback was not specified"), and a literal `import()` of an
 * absolute file:// URL outside the Vite project root also fails under
 * vite-node's SSR resolver on Windows. Both are Vitest/vite-node execution
 * quirks, not defects in the loader — the real mechanism is verified live
 * under plain `node` (see MASTER_PLAN.md §9). So `__setEntryImporterForTests`
 * swaps in a fake importer here that resolves fixture runtimes from an
 * in-memory map keyed by the exact absolute path the loader would import,
 * letting every non-import-mechanism concern (dependency ordering, failure
 * isolation, health polling, enable/disable) be exercised for real.
 */

let fixturesRoot: string;
const originalPluginsDir = process.env.PLUGINS_DIR;
const runtimes = new Map<string, Plugin>();

beforeAll(() => {
  __setEntryImporterForTests(async (specifier) => {
    const runtime = runtimes.get(specifier);
    if (!runtime) throw new Error(`no fixture runtime registered for ${specifier}`);
    return { default: runtime };
  });
});

afterAll(() => {
  __setEntryImporterForTests(undefined);
});

beforeEach(() => {
  fixturesRoot = mkdtempSync(join(tmpdir(), "constellation-plugins-"));
  runtimes.clear();
});

afterEach(() => {
  rmSync(fixturesRoot, { recursive: true, force: true });
  if (originalPluginsDir === undefined) delete process.env.PLUGINS_DIR;
  else process.env.PLUGINS_DIR = originalPluginsDir;
});

interface FixtureOptions {
  dependencies?: string[];
  runtime?: Plugin;
  /** Skip writing a dist entry file entirely (manifest-only plugin). */
  noEntry?: boolean;
  /** Write a dist entry file but never register a runtime for it (simulates a corrupt bundle). */
  unresolvableEntry?: boolean;
  /** Agent-plane tools to declare in the fixture's manifest. */
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; permission: string }>;
}

const defaultRuntime = (id: string): Plugin => ({
  register(ctx: PluginContext) {
    loadOrder.push(ctx.pluginId);
  },
  health(): HealthResult {
    return { status: "ok", detail: `${id} is fine` };
  },
});

let loadOrder: string[] = [];

/** Write a fixture plugin under fixturesRoot/<id> and register its (fake) runtime. */
function writeFixture(id: string, opts: FixtureOptions = {}): void {
  const dir = join(fixturesRoot, id);
  mkdirSync(dir, { recursive: true });
  const manifest = {
    manifestVersion: 1,
    id,
    name: id,
    version: "0.1.0",
    minPlatformVersion: "0.1.0",
    dependencies: opts.dependencies ?? [],
    tools: opts.tools ?? [],
    entry: "dist/index.js",
  };
  writeFileSync(join(dir, "plugin.manifest.json"), JSON.stringify(manifest, null, 2));

  if (opts.noEntry) return;
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "index.js"), "// fixture placeholder — loaded via the fake importer");

  if (opts.unresolvableEntry) return; // dist file exists, but no runtime registered for it
  const specifier = pathToFileURL(resolve(join(dir, "dist", "index.js"))).href;
  runtimes.set(specifier, opts.runtime ?? defaultRuntime(id));
}

function makeServices() {
  const registry = new PluginRegistryService();
  const lifecycle = new PluginLifecycleService(registry);
  const loader = new PluginLoaderService(registry, lifecycle);
  const health = new PluginHealthService(registry);
  return { registry, lifecycle, loader, health };
}

async function boot(fixturesDir: string) {
  process.env.PLUGINS_DIR = fixturesDir;
  const services = makeServices();
  await services.loader.onModuleInit();
  return services;
}

describe("PluginLoaderService — dependency ordering", () => {
  it("loads a dependency before its dependent, and both end up enabled", async () => {
    loadOrder = [];
    writeFixture("base");
    writeFixture("dependent", { dependencies: ["base"] });

    const { registry } = await boot(fixturesRoot);

    expect(loadOrder.indexOf("base")).toBeLessThan(loadOrder.indexOf("dependent"));
    expect(registry.get("base")?.state).toBe("enabled");
    expect(registry.get("dependent")?.state).toBe("enabled");
  });

  it("handles a diamond dependency graph in a valid topological order", async () => {
    loadOrder = [];
    writeFixture("base");
    writeFixture("left", { dependencies: ["base"] });
    writeFixture("right", { dependencies: ["base"] });
    writeFixture("top", { dependencies: ["left", "right"] });

    const { registry } = await boot(fixturesRoot);

    expect(loadOrder.indexOf("base")).toBeLessThan(loadOrder.indexOf("left"));
    expect(loadOrder.indexOf("base")).toBeLessThan(loadOrder.indexOf("right"));
    expect(loadOrder.indexOf("left")).toBeLessThan(loadOrder.indexOf("top"));
    expect(loadOrder.indexOf("right")).toBeLessThan(loadOrder.indexOf("top"));

    for (const id of ["base", "left", "right", "top"]) {
      expect(registry.get(id)?.state).toBe("enabled");
    }
  });
});

describe("PluginLoaderService — failure isolation", () => {
  it("marks a plugin with a missing dependency as failed, without crashing the rest", async () => {
    writeFixture("standalone");
    writeFixture("needs-ghost", { dependencies: ["ghost"] });

    const { registry } = await boot(fixturesRoot);

    expect(registry.get("standalone")?.state).toBe("enabled");
    const ghostDependent = registry.get("needs-ghost");
    expect(ghostDependent?.state).toBe("failed");
    expect(ghostDependent?.error).toContain("missing dependency");
    expect(ghostDependent?.error).toContain("ghost");
  });

  it("marks both plugins in a circular dependency as failed", async () => {
    writeFixture("cycle-a", { dependencies: ["cycle-b"] });
    writeFixture("cycle-b", { dependencies: ["cycle-a"] });
    writeFixture("innocent-bystander");

    const { registry } = await boot(fixturesRoot);

    expect(registry.get("cycle-a")?.state).toBe("failed");
    expect(registry.get("cycle-a")?.error).toContain("circular dependency");
    expect(registry.get("cycle-b")?.state).toBe("failed");
    expect(registry.get("cycle-b")?.error).toContain("circular dependency");
    // The rest of the world keeps working.
    expect(registry.get("innocent-bystander")?.state).toBe("enabled");
  });

  it("cascades a runtime failure (register() throws) to its dependents", async () => {
    writeFixture("broken", {
      runtime: {
        register() {
          throw new Error("boom");
        },
      },
    });
    writeFixture("relies-on-broken", { dependencies: ["broken"] });

    const { registry } = await boot(fixturesRoot);

    expect(registry.get("broken")?.state).toBe("failed");
    expect(registry.get("broken")?.error).toContain("register() threw");

    const dependent = registry.get("relies-on-broken");
    expect(dependent?.state).toBe("failed");
    expect(dependent?.error).toContain("depends on failed plugin");
    expect(dependent?.error).toContain("broken");
  });

  it("marks a plugin failed when its entry can't be imported, without crashing the rest", async () => {
    writeFixture("corrupt-bundle", { unresolvableEntry: true });
    writeFixture("well-formed");

    const { registry } = await boot(fixturesRoot);

    expect(registry.get("corrupt-bundle")?.state).toBe("failed");
    expect(registry.get("corrupt-bundle")?.error).toContain("entry failed to import");
    expect(registry.get("well-formed")?.state).toBe("enabled");
  });

  it("does not crash on an invalid manifest and still loads the other plugins", async () => {
    const badDir = join(fixturesRoot, "malformed");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "plugin.manifest.json"), JSON.stringify({ id: "Not_Kebab_Case" }));
    writeFixture("well-formed");

    const { registry } = await boot(fixturesRoot);

    // The malformed plugin never gets validated, so it's never registered at all.
    expect(registry.get("Not_Kebab_Case")).toBeUndefined();
    expect(registry.get("well-formed")?.state).toBe("enabled");
  });

  it("marks a manifest-only plugin (no built entry) as registered without crashing", async () => {
    writeFixture("manifest-only", { noEntry: true });

    const { registry } = await boot(fixturesRoot);

    // No register()/enable() hooks exist, so it registers+enables trivially.
    expect(registry.get("manifest-only")?.state).toBe("enabled");
  });
});

describe("PluginHealthService — health reflection", () => {
  it("stores the health() result for an enabled plugin", async () => {
    writeFixture("healthy");
    const { registry, health } = await boot(fixturesRoot);

    await health.pollAll();

    const p = registry.get("healthy");
    expect(p?.health?.status).toBe("ok");
    expect(p?.health?.detail).toContain("healthy is fine");
    expect(p?.healthCheckedAt).toBeDefined();
  });

  it("marks a throwing health() as down without crashing the poll loop", async () => {
    writeFixture("flaky", {
      runtime: {
        register() {},
        health() {
          throw new Error("db unreachable");
        },
      },
    });
    writeFixture("stable");

    const { registry, health } = await boot(fixturesRoot);
    await health.pollAll();

    expect(registry.get("flaky")?.health?.status).toBe("down");
    expect(registry.get("flaky")?.health?.detail).toContain("db unreachable");
    // The rest of the poll loop still ran.
    expect(registry.get("stable")?.health?.status).toBe("ok");
    // A throwing health() must never touch lifecycle state.
    expect(registry.get("flaky")?.state).toBe("enabled");
  });

  it("defaults to ok for a plugin whose runtime omits health()", async () => {
    writeFixture("no-health-hook", { runtime: { register() {} } });
    const { registry, health } = await boot(fixturesRoot);

    await health.pollAll();

    expect(registry.get("no-health-hook")?.health?.status).toBe("ok");
  });

  it("does not poll a plugin that failed to load", async () => {
    writeFixture("needs-ghost-2", { dependencies: ["nonexistent"] });
    const { registry, health } = await boot(fixturesRoot);

    await health.pollAll();

    expect(registry.get("needs-ghost-2")?.state).toBe("failed");
    expect(registry.get("needs-ghost-2")?.health).toBeUndefined();
  });
});

describe("PluginLifecycleService — enable/disable", () => {
  it("disable() then enable() round-trips cleanly and invokes the runtime hooks", async () => {
    const toggleLog: string[] = [];
    writeFixture("toggle", {
      runtime: {
        register(ctx: PluginContext) {
          ctx.logger.info("registered");
        },
        enable(ctx: PluginContext) {
          toggleLog.push(`enable:${ctx.pluginId}`);
        },
        disable(ctx: PluginContext) {
          toggleLog.push(`disable:${ctx.pluginId}`);
        },
      },
    });

    const { registry, lifecycle } = await boot(fixturesRoot);
    expect(registry.get("toggle")?.state).toBe("enabled");

    await lifecycle.disable("toggle");
    expect(registry.get("toggle")?.state).toBe("disabled");

    await lifecycle.enable("toggle");
    expect(registry.get("toggle")?.state).toBe("enabled");

    expect(toggleLog).toEqual(["enable:toggle", "disable:toggle", "enable:toggle"]);
  });

  it("marks a plugin failed if enable() throws, and refuses to re-enable it", async () => {
    writeFixture("explodes-on-enable", {
      runtime: {
        enable() {
          throw new Error("nope");
        },
      },
    });

    const { registry, lifecycle } = await boot(fixturesRoot);
    expect(registry.get("explodes-on-enable")?.state).toBe("failed");
    expect(registry.get("explodes-on-enable")?.error).toContain("enable() threw");

    await lifecycle.enable("explodes-on-enable");
    // Still failed — enable() is refused for a failed plugin.
    expect(registry.get("explodes-on-enable")?.state).toBe("failed");
  });

  it("refuses to disable a plugin that isn't enabled", async () => {
    const registry = new PluginRegistryService();
    const lifecycle = new PluginLifecycleService(registry);
    registry.register({
      manifest: {
        manifestVersion: 1,
        id: "never-enabled",
        name: "never-enabled",
        version: "0.1.0",
        minPlatformVersion: "0.1.0",
        description: "",
        author: "",
        license: "UNLICENSED",
        dependencies: [],
        requiredServices: [],
        permissions: [],
        navigation: [],
        routes: [],
        featureFlags: [],
        settings: [],
        jobs: [],
        entry: "dist/index.js",
        healthCheck: "/health",
        translations: [],
      },
      runtime: {},
      state: "registered",
      dir: fixturesRoot,
    });

    await lifecycle.disable("never-enabled");
    expect(registry.get("never-enabled")?.state).toBe("registered");
  });
});

describe("PluginLoaderService — platform lifecycle events", () => {
  /**
   * The event bus is injected `@Optional()`-ly into the loader and lifecycle
   * service. These tests wire a REAL EventBusService by hand (it has a
   * zero-arg constructor and no DI dependencies) and subscribe through the
   * public `forPlugin(...).onPlatform` surface — the same path a plugin uses.
   */
  function bootWithBus(fixturesDir: string) {
    process.env.PLUGINS_DIR = fixturesDir;
    const bus = new EventBusService();
    const registry = new PluginRegistryService();
    const lifecycle = new PluginLifecycleService(registry, undefined, bus);
    const loader = new PluginLoaderService(registry, lifecycle, undefined, bus);

    const seen: Array<{ topic: string; payload: Record<string, unknown> }> = [];
    const events = bus.forPlugin("observer");
    for (const topic of ["plugin:registered", "plugin:enabled", "plugin:failed", "plugin:disabled"]) {
      events.onPlatform(topic, (payload) => {
        seen.push({ topic, payload: payload as Record<string, unknown> });
      });
    }
    return { bus, registry, lifecycle, loader, seen, boot: () => loader.onModuleInit() };
  }

  const topicsFor = (
    seen: Array<{ topic: string; payload: Record<string, unknown> }>,
    pluginId: string,
  ): string[] => seen.filter((e) => e.payload.pluginId === pluginId).map((e) => e.topic);

  it("publishes plugin:registered then plugin:enabled for a healthy plugin", async () => {
    writeFixture("eventful");
    const h = bootWithBus(fixturesRoot);
    await h.boot();

    expect(topicsFor(h.seen, "eventful")).toEqual(["plugin:registered", "plugin:enabled"]);
    const registered = h.seen.find((e) => e.topic === "plugin:registered");
    expect(registered?.payload).toMatchObject({ pluginId: "eventful", version: "0.1.0" });
  });

  it("publishes plugin:failed (and never plugin:enabled) for a plugin whose register() throws", async () => {
    writeFixture("exploding", {
      runtime: {
        register() {
          throw new Error("kaboom");
        },
      },
    });
    const h = bootWithBus(fixturesRoot);
    await h.boot();

    const topics = topicsFor(h.seen, "exploding");
    expect(topics).toContain("plugin:failed");
    expect(topics).not.toContain("plugin:enabled");
    const failed = h.seen.find((e) => e.topic === "plugin:failed");
    expect(String(failed?.payload.error)).toContain("kaboom");
  });

  it("publishes plugin:failed for a plugin blocked by a missing dependency", async () => {
    writeFixture("orphan", { dependencies: ["nowhere"] });
    const h = bootWithBus(fixturesRoot);
    await h.boot();

    const failed = h.seen.find((e) => e.topic === "plugin:failed" && e.payload.pluginId === "orphan");
    expect(failed).toBeDefined();
    expect(String(failed?.payload.error)).toContain("missing dependency");
  });

  it("publishes plugin:disabled when a plugin is disabled", async () => {
    writeFixture("toggle");
    const h = bootWithBus(fixturesRoot);
    await h.boot();
    await h.lifecycle.disable("toggle");

    expect(topicsFor(h.seen, "toggle")).toEqual(["plugin:registered", "plugin:enabled", "plugin:disabled"]);
  });

  it("includes declared tool names on plugin:registered", async () => {
    writeFixture("toolbox", {
      tools: [
        { name: "demo.ping", description: "ping", inputSchema: {}, permission: "demo:ping" },
      ],
    });
    const h = bootWithBus(fixturesRoot);
    await h.boot();

    const registered = h.seen.find((e) => e.topic === "plugin:registered" && e.payload.pluginId === "toolbox");
    expect(registered?.payload.tools).toEqual(["demo.ping"]);
  });

  it("still boots plugins when NO event bus is wired (offline path stays intact)", async () => {
    writeFixture("busless");
    const { registry } = await boot(fixturesRoot);
    expect(registry.get("busless")?.state).toBe("enabled");
  });
});
