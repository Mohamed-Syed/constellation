import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { ConfigService } from "@nestjs/config";
import { PluginSandboxService, __setSandboxSpawnForTests } from "./plugin-sandbox.service.js";
import type { LoadedPlugin, PluginManifest } from "@constellation/plugin-sdk";

/**
 * PluginSandboxService tests (Phase 2.0 2.7) — the process-mode sandbox.
 * The only external seam is the spawner, swapped via
 * `__setSandboxSpawnForTests` — no test spawns real node, no sockets.
 *
 * Contracts under test:
 *  1. Opt-in, operator-controlled: mode off → nothing sandboxed; mode
 *     process + a plugin list (or `*`) → exactly those plugins.
 *  2. dispatch() spawns the runner with the memory cap and the job file, and
 *     returns the plugin's ToolResult on success.
 *  3. Every failure class becomes an honest `ok:false` envelope: non-zero
 *     exit (crash/OOM), wall-clock timeout (killed), spawn error, malformed
 *     or oversized output.
 */

function makeConfig(overrides: Record<string, string> = {}) {
  return {
    get: vi.fn((key: string, fallback?: unknown) => {
      if (key in overrides) return overrides[key];
      return fallback;
    }),
  } as unknown as ConfigService;
}

function makePlugin(overrides: Partial<PluginManifest> = {}): LoadedPlugin {
  return {
    manifest: {
      id: "test-plugin",
      version: "0.0.1",
      entry: "dist/index.js",
      tools: [],
      settings: [],
      ...overrides,
    } as PluginManifest,
    runtime: {},
    state: "enabled",
    dir: "/plugins/test-plugin",
  } as unknown as LoadedPlugin;
}

interface SpawnSim {
  stdoutLines?: string[];
  stderrLines?: string[];
  exitCode?: number | null;
  emitError?: Error;
  neverClose?: boolean;
  /** Called with the job file path while it still exists (before cleanup). */
  onSpawn?: (jobFile: string) => void;
}

/** A fake spawn: returns a child-like EventEmitter; the test drives it. */
function fakeSpawn(sim: SpawnSim) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    exitCode: number | null;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.kill = vi.fn(() => true);
  const spawnMock = vi.fn((_exec: string, args: string[]) => {
    sim.onSpawn?.(args[2] ?? "");
    return child;
  }) as unknown as ReturnType<typeof vi.fn>;

  // Drive the simulation on the next tick so the parent's listeners attach first.
  setTimeout(() => {
    if (sim.emitError) {
      child.emit("error", sim.emitError);
      return;
    }
    if (sim.stdoutLines) for (const line of sim.stdoutLines) child.stdout.emit("data", Buffer.from(line + "\n"));
    if (sim.stderrLines) for (const line of sim.stderrLines) child.stderr.emit("data", Buffer.from(line + "\n"));
    if (!sim.neverClose) {
      child.exitCode = sim.exitCode ?? 0;
      child.emit("close", child.exitCode);
    }
  }, 0);

  return { spawnMock, child };
}

const TOOL_RESULT = { ok: true, result: { greeting: "hello from the sandbox" } };

beforeEach(() => {
  __setSandboxSpawnForTests(undefined);
});

afterEach(() => {
  __setSandboxSpawnForTests(undefined);
  vi.restoreAllMocks();
});

describe("PluginSandboxService — opt-in selection", () => {
  it("mode off (default) sandboxes nothing", () => {
    const svc = new PluginSandboxService(makeConfig());
    expect(svc.shouldSandbox("graphify")).toBe(false);
    expect(svc.shouldSandbox("anything")).toBe(false);
  });

  it("mode process + explicit list sandboxes only the listed plugins", () => {
    const svc = new PluginSandboxService(makeConfig({ PLUGIN_SANDBOX_MODE: "process", PLUGIN_SANDBOX_PLUGINS: "graphify, browser-use" }));
    expect(svc.shouldSandbox("graphify")).toBe(true);
    expect(svc.shouldSandbox("browser-use")).toBe(true);
    expect(svc.shouldSandbox("hello-world")).toBe(false);
  });

  it("mode process + * sandboxes every plugin", () => {
    const svc = new PluginSandboxService(makeConfig({ PLUGIN_SANDBOX_MODE: "process", PLUGIN_SANDBOX_PLUGINS: "*" }));
    expect(svc.shouldSandbox("graphify")).toBe(true);
    expect(svc.shouldSandbox("hello-world")).toBe(true);
  });

  it("mode process with an empty plugin list sandboxes nothing (least privilege by default)", () => {
    const svc = new PluginSandboxService(makeConfig({ PLUGIN_SANDBOX_MODE: "process" }));
    expect(svc.shouldSandbox("graphify")).toBe(false);
  });
});

describe("PluginSandboxService — dispatch()", () => {
  it("spawns the runner with the memory cap + job file and returns the plugin's ToolResult", async () => {
    const { spawnMock, child } = fakeSpawn({ stdoutLines: [JSON.stringify(TOOL_RESULT)] });
    __setSandboxSpawnForTests(spawnMock as unknown as typeof import("node:child_process").spawn);
    const svc = new PluginSandboxService(makeConfig({ PLUGIN_SANDBOX_MODE: "process", PLUGIN_SANDBOX_PLUGINS: "test-plugin" }));

    const result = await svc.dispatch(makePlugin(), "greet", { name: "world" });

    expect(result).toEqual(TOOL_RESULT);
    expect(spawnMock).toHaveBeenCalledOnce();
    const [execPath, args, opts] = spawnMock.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(execPath).toBe(process.execPath);
    expect(args[0]).toBe("--max-old-space-size=256");
    expect(args[1]).toMatch(/plugin-sandbox-runner\.mjs$/);
    expect(args[2]).toMatch(/job\.json$/);
    expect(opts.env).toBe(process.env);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("turns a non-zero exit (crash/OOM) into an honest ok:false with the stderr tail", async () => {
    const { spawnMock } = fakeSpawn({ exitCode: 1, stderrLines: ["FATAL ERROR: Reached heap limit"] });
    __setSandboxSpawnForTests(spawnMock as unknown as typeof import("node:child_process").spawn);
    const svc = new PluginSandboxService(makeConfig({ PLUGIN_SANDBOX_MODE: "process", PLUGIN_SANDBOX_PLUGINS: "test-plugin" }));

    const result = await svc.dispatch(makePlugin(), "boom", {});

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exit 1/);
    expect(result.error).toContain("FATAL ERROR");
  });

  it("kills a hung child at the timeout and reports it honestly", async () => {
    const { spawnMock, child } = fakeSpawn({ neverClose: true });
    __setSandboxSpawnForTests(spawnMock as unknown as typeof import("node:child_process").spawn);
    const svc = new PluginSandboxService(
      makeConfig({ PLUGIN_SANDBOX_MODE: "process", PLUGIN_SANDBOX_PLUGINS: "test-plugin", PLUGIN_SANDBOX_TIMEOUT_MS: "20" }),
    );

    const result = await svc.dispatch(makePlugin(), "hang", {});

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/killed by timeout after 20ms/);
  });

  it("reports a spawn error (e.g. node missing) as ok:false", async () => {
    const { spawnMock } = fakeSpawn({ emitError: new Error("spawn node ENOENT") });
    __setSandboxSpawnForTests(spawnMock as unknown as typeof import("node:child_process").spawn);
    const svc = new PluginSandboxService(makeConfig({ PLUGIN_SANDBOX_MODE: "process", PLUGIN_SANDBOX_PLUGINS: "test-plugin" }));

    const result = await svc.dispatch(makePlugin(), "greet", {});

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/spawn error/);
  });

  it("rejects malformed runner output (no valid JSON line) as ok:false", async () => {
    const { spawnMock } = fakeSpawn({ stdoutLines: ["this is not json"] });
    __setSandboxSpawnForTests(spawnMock as unknown as typeof import("node:child_process").spawn);
    const svc = new PluginSandboxService(makeConfig({ PLUGIN_SANDBOX_MODE: "process", PLUGIN_SANDBOX_PLUGINS: "test-plugin" }));

    const result = await svc.dispatch(makePlugin(), "greet", {});

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/failed \(exit 0\)/);
  });

  it("kills a child whose output overflows the result cap (never buffers unbounded)", async () => {
    const { spawnMock, child } = fakeSpawn({ neverClose: true });
    __setSandboxSpawnForTests(spawnMock as unknown as typeof import("node:child_process").spawn);
    const svc = new PluginSandboxService(
      makeConfig({
        PLUGIN_SANDBOX_MODE: "process",
        PLUGIN_SANDBOX_PLUGINS: "test-plugin",
        PLUGIN_SANDBOX_MAX_RESULT_BYTES: "64",
      }),
    );

    const dispatchPromise = svc.dispatch(makePlugin(), "big", {});
    // Drive the overflow: emit more than the cap.
    child.stdout.emit("data", Buffer.from("x".repeat(200)));
    const result = await dispatchPromise;

    expect(child.kill).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exceeded 64 bytes/);
  });

  it("passes the manifest settings defaults into the job so the child config resolves them", async () => {
    let capturedJob: { pluginId: string; settings: unknown[] } | undefined;
    const { spawnMock } = fakeSpawn({
      stdoutLines: [JSON.stringify(TOOL_RESULT)],
      onSpawn: (jobFile) => {
        capturedJob = JSON.parse(readFileSync(jobFile, "utf8"));
      },
    });
    __setSandboxSpawnForTests(spawnMock as unknown as typeof import("node:child_process").spawn);
    const svc = new PluginSandboxService(makeConfig({ PLUGIN_SANDBOX_MODE: "process", PLUGIN_SANDBOX_PLUGINS: "test-plugin" }));
    const plugin = makePlugin({
      settings: [{ key: "baseUrl", label: "Base", type: "string", default: "" }],
    });

    await svc.dispatch(plugin, "greet", {});

    expect(capturedJob?.pluginId).toBe("test-plugin");
    expect(capturedJob?.settings).toEqual([{ key: "baseUrl", label: "Base", type: "string", default: "" }]);
  });
});
