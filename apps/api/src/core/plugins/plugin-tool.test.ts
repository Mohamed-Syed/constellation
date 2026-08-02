import { describe, expect, it, vi } from "vitest";
import type { LoadedPlugin, PluginManifest, ToolResult } from "@constellation/plugin-sdk";
import { PluginRegistryService } from "./plugin-registry.service.js";
import { PluginToolService } from "./plugin-tool.service.js";

/**
 * Tests for the agent-plane dispatcher. Hand-wired with NO Nest DI container
 * (both `PluginContextFactory` and `EventBusService` are `@Optional()`), which
 * is the established offline pattern in this module — see `plugin-loader.test.ts`.
 *
 * The security-relevant assertions here are the per-tool permission checks and
 * the containment guarantees: this is the one endpoint that runs plugin code on
 * demand, so "no plugin code ran" is as important as "the right answer came back."
 */

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    manifestVersion: 2,
    id: "cap",
    name: "cap",
    version: "1.0.0",
    description: "",
    author: "",
    license: "",
    repository: "",
    minPlatformVersion: "0.1.0",
    dependencies: [],
    requiredServices: [],
    permissions: [],
    navigation: [],
    routes: [],
    featureFlags: [],
    settings: [],
    jobs: [],
    translations: [],
    entry: "dist/index.js",
    tools: [
      {
        name: "cap.read",
        description: "read something",
        inputSchema: { type: "object" },
        permission: "cap:read",
      },
      {
        name: "cap.write",
        description: "write something",
        inputSchema: { type: "object" },
        permission: "cap:write",
      },
    ],
    ...overrides,
  } as PluginManifest;
}

function loaded(
  invokeTool: LoadedPlugin["runtime"]["invokeTool"],
  overrides: Partial<LoadedPlugin> = {},
): LoadedPlugin {
  return {
    manifest: manifest(),
    runtime: invokeTool ? { invokeTool } : {},
    state: "enabled",
    dir: "/tmp/cap",
    ...overrides,
  } as LoadedPlugin;
}

function serviceWith(plugin?: LoadedPlugin, events?: { emitPlatform: (e: string, p: unknown) => void }) {
  const registry = new PluginRegistryService();
  if (plugin) registry.register(plugin);
  // No context factory -> buildContextWith falls back to stubContext.
  const svc = new PluginToolService(registry, undefined, events as never);
  return { svc, registry };
}

const ADMIN = ["platform:admin"];

describe("PluginToolService — resolution", () => {
  it("rejects an unknown plugin", async () => {
    const { svc } = serviceWith();
    const out = await svc.invoke("nope", "cap.read", {}, ADMIN);
    expect(out.outcome).toBe("rejected");
    if (out.outcome === "rejected") expect(out.reason).toBe("plugin-not-found");
  });

  it("refuses to invoke tools on a plugin that isn't enabled", async () => {
    const spy = vi.fn();
    const { svc } = serviceWith(loaded(spy, { state: "disabled" }));
    const out = await svc.invoke("cap", "cap.read", {}, ADMIN);
    expect(out.outcome).toBe("rejected");
    if (out.outcome === "rejected") expect(out.reason).toBe("plugin-not-enabled");
    expect(spy).not.toHaveBeenCalled(); // no plugin code ran
  });

  it("refuses a tool the manifest does not declare, even if the runtime handles it", async () => {
    const spy = vi.fn(async (): Promise<ToolResult> => ({ ok: true, data: "should not happen" }));
    const { svc } = serviceWith(loaded(spy));
    const out = await svc.invoke("cap", "cap.secret", {}, ADMIN);
    expect(out.outcome).toBe("rejected");
    if (out.outcome === "rejected") {
      expect(out.reason).toBe("tool-not-declared");
      expect(out.message).toContain("cap.read"); // lists what IS declared
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a declared tool with no runtime implementation", async () => {
    const { svc } = serviceWith(loaded(undefined));
    const out = await svc.invoke("cap", "cap.read", {}, ADMIN);
    expect(out.outcome).toBe("rejected");
    if (out.outcome === "rejected") expect(out.reason).toBe("not-invocable");
  });

  it("lists declared tools for a plugin, and [] for an unknown one", () => {
    const { svc } = serviceWith(loaded(vi.fn()));
    expect(svc.listTools("cap").map((t) => t.name)).toEqual(["cap.read", "cap.write"]);
    expect(svc.listTools("nope")).toEqual([]);
  });
});

describe("PluginToolService — per-tool authorization", () => {
  it("denies a caller lacking the tool's own permission", async () => {
    const spy = vi.fn();
    const { svc } = serviceWith(loaded(spy));
    const out = await svc.invoke("cap", "cap.write", {}, ["cap:read"]);
    expect(out.outcome).toBe("rejected");
    if (out.outcome === "rejected") {
      expect(out.reason).toBe("forbidden");
      expect(out.requiredPermission).toBe("cap:write");
    }
    expect(spy).not.toHaveBeenCalled(); // denied BEFORE any plugin code runs
  });

  it("allows a caller holding exactly the tool's permission", async () => {
    const spy = vi.fn(async (): Promise<ToolResult> => ({ ok: true, data: 1 }));
    const { svc } = serviceWith(loaded(spy));
    const out = await svc.invoke("cap", "cap.read", {}, ["cap:read"]);
    expect(out.outcome).toBe("completed");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("separates read from write — holding read does not grant write", async () => {
    const { svc } = serviceWith(loaded(async (): Promise<ToolResult> => ({ ok: true, data: 1 })));
    const read = await svc.invoke("cap", "cap.read", {}, ["cap:read"]);
    const write = await svc.invoke("cap", "cap.write", {}, ["cap:read"]);
    expect(read.outcome).toBe("completed");
    expect(write.outcome).toBe("rejected");
  });

  it("honors SDK wildcard semantics", async () => {
    const { svc } = serviceWith(loaded(async (): Promise<ToolResult> => ({ ok: true, data: 1 })));
    expect((await svc.invoke("cap", "cap.write", {}, ["cap:*"])).outcome).toBe("completed");
  });

  it("platform:admin implies every tool permission", async () => {
    const { svc } = serviceWith(loaded(async (): Promise<ToolResult> => ({ ok: true, data: 1 })));
    expect((await svc.invoke("cap", "cap.write", {}, ADMIN)).outcome).toBe("completed");
  });

  it("denies a caller with no permissions at all", async () => {
    const { svc } = serviceWith(loaded(vi.fn()));
    const out = await svc.invoke("cap", "cap.read", {}, []);
    expect(out.outcome).toBe("rejected");
    if (out.outcome === "rejected") expect(out.reason).toBe("forbidden");
  });
});

describe("PluginToolService — dispatch & containment", () => {
  it("passes the tool name and args through to the runtime", async () => {
    const spy = vi.fn(async (): Promise<ToolResult> => ({ ok: true, data: "ok" }));
    const { svc } = serviceWith(loaded(spy));
    await svc.invoke("cap", "cap.read", { a: 1 }, ADMIN);
    expect(spy).toHaveBeenCalledWith("cap.read", { a: 1 }, expect.objectContaining({ pluginId: "cap" }));
  });

  it("returns a tool's ok:false envelope as a COMPLETED call, not a rejection", async () => {
    const { svc } = serviceWith(loaded(async (): Promise<ToolResult> => ({ ok: false, error: "upstream down" })));
    const out = await svc.invoke("cap", "cap.read", {}, ADMIN);
    expect(out.outcome).toBe("completed");
    if (out.outcome === "completed") {
      expect(out.result).toEqual({ ok: false, error: "upstream down" });
    }
  });

  it("converts a THROWING tool into ok:false instead of propagating", async () => {
    const { svc } = serviceWith(
      loaded(async () => {
        throw new Error("plugin exploded");
      }),
    );
    const out = await svc.invoke("cap", "cap.read", {}, ADMIN);
    expect(out.outcome).toBe("completed");
    if (out.outcome === "completed") {
      expect(out.result.ok).toBe(false);
      if (!out.result.ok) expect(out.result.error).toContain("plugin exploded");
    }
  });

  it("normalizes a malformed (non-ToolResult) return value", async () => {
    const { svc } = serviceWith(loaded((async () => "just a string") as never));
    const out = await svc.invoke("cap", "cap.read", {}, ADMIN);
    expect(out.outcome).toBe("completed");
    if (out.outcome === "completed") {
      expect(out.result.ok).toBe(false);
      if (!out.result.ok) expect(out.result.error).toMatch(/malformed ToolResult/);
    }
  });

  it("reports a duration for a completed call", async () => {
    const { svc } = serviceWith(loaded(async (): Promise<ToolResult> => ({ ok: true, data: 1 })));
    const out = await svc.invoke("cap", "cap.read", {}, ADMIN);
    if (out.outcome === "completed") expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits a platform event with the outcome when an event bus is present", async () => {
    const emitPlatform = vi.fn();
    const { svc } = serviceWith(loaded(async (): Promise<ToolResult> => ({ ok: true, data: 1 })), {
      emitPlatform,
    });
    await svc.invoke("cap", "cap.read", {}, ADMIN);
    expect(emitPlatform).toHaveBeenCalledWith(
      "plugin:tool:invoked",
      expect.objectContaining({ pluginId: "cap", tool: "cap.read", ok: true }),
    );
  });

  it("still returns the result when the event bus throws", async () => {
    const { svc } = serviceWith(loaded(async (): Promise<ToolResult> => ({ ok: true, data: 1 })), {
      emitPlatform: () => {
        throw new Error("bus down");
      },
    });
    const out = await svc.invoke("cap", "cap.read", {}, ADMIN);
    expect(out.outcome).toBe("completed");
  });

  it("works with no event bus at all (offline DI)", async () => {
    const { svc } = serviceWith(loaded(async (): Promise<ToolResult> => ({ ok: true, data: 1 })));
    expect((await svc.invoke("cap", "cap.read", {}, ADMIN)).outcome).toBe("completed");
  });
});
