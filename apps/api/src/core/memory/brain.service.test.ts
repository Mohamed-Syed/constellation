import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrainService } from "./brain.service.js";
import {
  GraphifyAdapter,
  __setFetchForTests,
  __setShellForTests,
} from "./graphify.adapter.js";

/**
 * The brain's contract under test is mostly about NOT crashing: every method
 * must return a sane, honest value with no graph, no CLI, and no sidecar.
 * Each test gets a throwaway temp dir as its repo root so nothing touches the
 * real vault, and both external seams (fetch, spawn) are stubbed — no test
 * here opens a socket or starts a process.
 */

let tmp: string;
const savedEnv = { ...process.env };

async function makeAdapter(): Promise<GraphifyAdapter> {
  return new GraphifyAdapter();
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "constellation-brain-"));
  process.env.BRAIN_REPO_ROOT = tmp;
  process.env.BRAIN_VAULT_DIR = path.join(tmp, "brain");
  process.env.GRAPHIFY_GRAPH_PATH = path.join(tmp, "graphify-out", "graph.json");
  delete process.env.GRAPHIFY_MCP_URL;
  // Default: no Graphify CLI on PATH.
  __setShellForTests(async () => ({ code: -1, stdout: "", stderr: "ENOENT" }));
  __setFetchForTests(undefined);
});

afterEach(async () => {
  __setShellForTests(undefined);
  __setFetchForTests(undefined);
  process.env = { ...savedEnv };
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeGraph(nodes: unknown[], edges: unknown[]): Promise<void> {
  const p = process.env.GRAPHIFY_GRAPH_PATH!;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify({ nodes, edges, meta: { engine: "graphify" } }), "utf8");
}

describe("BrainService — degraded mode (no graph, no sidecar, no CLI)", () => {
  it("stats() reports available:false instead of throwing", async () => {
    const brain = new BrainService(await makeAdapter());
    const stats = await brain.stats();
    expect(stats.available).toBe(false);
    expect(stats.nodes).toBe(0);
    expect(stats.edges).toBe(0);
    expect(stats.lastBuiltAt).toBeNull();
    expect(stats.detail).toMatch(/brain not built yet/i);
  });

  it("graph() returns an empty graph carrying the reason, not an error", async () => {
    const brain = new BrainService(await makeAdapter());
    const g = await brain.graph();
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.meta?.available).toBe(false);
  });

  it("query() abstains honestly with grounded:false", async () => {
    const brain = new BrainService(await makeAdapter());
    const a = await brain.query("what connects the loader to the SDK?");
    expect(a.grounded).toBe(false);
    expect(a.answer).toMatch(/brain not built yet/i);
    expect(a.provenance).toEqual([]);
  });

  it("explain() and path() return null/empty rather than throwing", async () => {
    const brain = new BrainService(await makeAdapter());
    expect(await brain.explain("nope")).toBeNull();
    expect(await brain.path("a", "b")).toEqual([]);
  });

  it("remember() still works with no engine — the vault is just files", async () => {
    const brain = new BrainService(await makeAdapter());
    await brain.remember({ title: "T1", body: "B1", tags: ["x"], source: "test" });
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(tmp, "brain", "notes", `${day}.md`);
    const text = await fs.readFile(file, "utf8");
    expect(text).toContain("## T1");
    expect(text).toContain("B1");
    expect(text).toContain("#x");
    expect(text).toContain("**source:** test");
  });

  it("remember() appends rather than overwriting, and writes the header once", async () => {
    const brain = new BrainService(await makeAdapter());
    await brain.remember({ title: "One", body: "first" });
    await brain.remember({ title: "Two", body: "second" });
    const day = new Date().toISOString().slice(0, 10);
    const text = await fs.readFile(path.join(tmp, "brain", "notes", `${day}.md`), "utf8");
    expect(text).toContain("## One");
    expect(text).toContain("## Two");
    expect(text.match(/# Brain notes/g)?.length).toBe(1);
  });

  it("remember() into an unwritable vault degrades (no throw)", async () => {
    // Point the vault at a path whose parent is a FILE — mkdir must fail.
    const blocker = path.join(tmp, "blocker");
    await fs.writeFile(blocker, "not a dir", "utf8");
    process.env.BRAIN_VAULT_DIR = path.join(blocker, "vault");
    const brain = new BrainService(await makeAdapter());
    await expect(brain.remember({ title: "T", body: "B" })).resolves.toBeUndefined();
  });

  it("after remember(), query() surfaces the vault match but keeps grounded:false", async () => {
    const brain = new BrainService(await makeAdapter());
    await brain.remember({ title: "Loader uses pathToFileURL", body: "windows dynamic import" });
    const a = await brain.query("pathToFileURL windows");
    expect(a.grounded).toBe(false);
    expect(a.answer).toMatch(/vault/i);
    expect(a.provenance.length).toBeGreaterThan(0);
    expect(a.provenance[0].kind).toBe("vault-note");
  });

  it("stats() counts vault notes even with no graph", async () => {
    const brain = new BrainService(await makeAdapter());
    await brain.remember({ title: "T", body: "B" });
    const stats = await brain.stats();
    expect(stats.available).toBe(false);
    expect(stats.vaultNotes).toBe(1);
  });

  it("query('') is rejected politely, not thrown", async () => {
    const brain = new BrainService(await makeAdapter());
    const a = await brain.query("   ");
    expect(a.grounded).toBe(false);
    expect(a.provenance).toEqual([]);
  });
});

describe("BrainService — local mode (graph.json on disk)", () => {
  it("stats() reports real counts and available:true", async () => {
    await writeGraph([{ id: "a" }, { id: "b" }], [{ source: "a", target: "b" }]);
    const brain = new BrainService(await makeAdapter());
    const stats = await brain.stats();
    expect(stats.available).toBe(true);
    expect(stats.nodes).toBe(2);
    expect(stats.edges).toBe(1);
    expect(stats.lastBuiltAt).toBeTruthy();
  });

  it("graph() passes the document through for the portal", async () => {
    await writeGraph([{ id: "a", label: "A" }], []);
    const brain = new BrainService(await makeAdapter());
    const g = await brain.graph();
    expect(g.nodes).toHaveLength(1);
    expect(g.meta?.engine).toBe("graphify");
  });

  it("tolerates alternative key spellings (vertices/links)", async () => {
    const p = process.env.GRAPHIFY_GRAPH_PATH!;
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify({ vertices: [{ id: "x" }], links: [] }), "utf8");
    const brain = new BrainService(await makeAdapter());
    expect((await brain.stats()).nodes).toBe(1);
  });

  it("malformed graph.json degrades to unavailable, does not throw", async () => {
    const p = process.env.GRAPHIFY_GRAPH_PATH!;
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, "{ this is not json", "utf8");
    const brain = new BrainService(await makeAdapter());
    const stats = await brain.stats();
    expect(stats.available).toBe(false);
    expect(await brain.graph()).toMatchObject({ nodes: [], edges: [] });
  });

  it("explain() answers from graph.json when there is no sidecar", async () => {
    await writeGraph(
      [{ id: "loader", label: "PluginLoader", kind: "class", path: "src/loader.ts" }, { id: "sdk" }],
      [{ source: "loader", target: "sdk", type: "imports" }],
    );
    const brain = new BrainService(await makeAdapter());
    const e = await brain.explain("loader");
    expect(e?.node.label).toBe("PluginLoader");
    expect(e?.neighbors.map((n) => n.id)).toContain("sdk");
    expect(e?.summary).toContain("src/loader.ts");
  });

  it("path() BFS-walks graph.json", async () => {
    await writeGraph(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    );
    const brain = new BrainService(await makeAdapter());
    expect((await brain.path("a", "c")).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("path() returns empty for unreachable / unknown nodes", async () => {
    await writeGraph([{ id: "a" }, { id: "z" }], []);
    const brain = new BrainService(await makeAdapter());
    expect(await brain.path("a", "z")).toEqual([]);
    expect(await brain.path("a", "missing")).toEqual([]);
  });

  it("query() uses the graphify CLI and extracts file provenance", async () => {
    __setShellForTests(async (cmd, args) => {
      expect(cmd).toBe("graphify");
      expect(args[0]).toBe("query");
      return { code: 0, stdout: "The loader imports the SDK in src/loader.ts:12", stderr: "" };
    });
    const brain = new BrainService(await makeAdapter());
    const a = await brain.query("how does the loader reach the SDK?");
    expect(a.grounded).toBe(true);
    expect(a.answer).toContain("imports the SDK");
    expect(a.provenance[0].id).toBe("src/loader.ts:12");
  });

  it("a failing CLI degrades to an ungrounded answer, not a 500", async () => {
    __setShellForTests(async () => ({ code: 1, stdout: "", stderr: "boom" }));
    const brain = new BrainService(await makeAdapter());
    const a = await brain.query("anything");
    expect(a.grounded).toBe(false);
  });

  // REGRESSION (found live 2026-08-02, containerized sidecar verification):
  // inside the api image there is no `graphify` CLI and GRAPHIFY_MCP_URL is
  // deliberately unset, so query() fell through to a vault text-scan and
  // reported "Brain not built yet" even with a fully-built 1238-node graph
  // mounted at /brain/graph.json. query() must answer FROM graph.json.
  it("query() answers from graph.json when there is no CLI and no sidecar", async () => {
    await writeGraph(
      [
        { id: "loader", label: "PluginLoader", path: "apps/api/src/core/plugins/loader.ts" },
        { id: "sdk", label: "plugin-sdk", path: "packages/plugin-sdk/src/index.ts" },
        { id: "unrelated", label: "TeapotService", path: "apps/api/src/core/teapot.ts" },
      ],
      [{ source: "loader", target: "sdk", type: "imports" }],
    );
    __setShellForTests(async () => ({ code: -1, stdout: "", stderr: "ENOENT: graphify not found" }));
    const brain = new BrainService(await makeAdapter());
    const a = await brain.query("what connects the plugin loader to the SDK?");
    expect(a.grounded).toBe(true);
    expect(a.answer).toContain("From the knowledge graph");
    expect(a.provenance.length).toBeGreaterThan(0);
    // Provenance must be real graph nodes, not vault-note line matches.
    expect(a.provenance.every((p) => p.kind !== "vault-note")).toBe(true);
    expect(a.provenance.map((p) => p.id)).toContain("loader");
  });

  it("query() with no matching node still abstains honestly", async () => {
    await writeGraph([{ id: "loader", label: "PluginLoader" }], []);
    __setShellForTests(async () => ({ code: -1, stdout: "", stderr: "no cli" }));
    const brain = new BrainService(await makeAdapter());
    const a = await brain.query("zzzznomatchingnodezzzz");
    expect(a.grounded).toBe(false);
  });
});

describe("BrainService — MCP mode", () => {
  beforeEach(() => {
    process.env.GRAPHIFY_MCP_URL = "http://sidecar:8765/mcp";
  });

  it("query() calls tools/call and returns a grounded answer with provenance", async () => {
    const seen: { body?: string } = {};
    __setFetchForTests(async (_url, init) => {
      seen.body = init?.body;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              content: [{ type: "text", text: "The loader imports the SDK contract." }],
              provenance: [{ id: "n1", label: "plugin-loader.service.ts", kind: "file", score: 0.9 }],
            },
          }),
      };
    });
    const brain = new BrainService(await makeAdapter());
    const a = await brain.query("what connects the plugin loader to the SDK?");
    expect(a.grounded).toBe(true);
    expect(a.answer).toContain("imports the SDK contract");
    expect(a.provenance[0].label).toBe("plugin-loader.service.ts");
    const sent = JSON.parse(seen.body!);
    expect(sent.method).toBe("tools/call");
    expect(sent.params.name).toBe("query_graph");
  });

  it("parses an SSE-framed MCP response", async () => {
    __setFetchForTests(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", result: { answer: "streamed" } })}\n\n`,
    }));
    const brain = new BrainService(await makeAdapter());
    expect((await brain.query("q")).answer).toBe("streamed");
  });

  it("an unreachable sidecar degrades to ungrounded, never throws", async () => {
    __setFetchForTests(async () => {
      throw new Error("ECONNREFUSED");
    });
    const brain = new BrainService(await makeAdapter());
    const a = await brain.query("q");
    expect(a.grounded).toBe(false);
    expect(a.answer).toMatch(/brain not built yet|don't know/i);
  });

  it("an MCP JSON-RPC error degrades to ungrounded", async () => {
    __setFetchForTests(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: "2.0", error: { code: -32601, message: "no such tool" } }),
    }));
    const brain = new BrainService(await makeAdapter());
    expect((await brain.query("q")).grounded).toBe(false);
  });

  it("an HTTP 500 from the sidecar degrades to ungrounded", async () => {
    __setFetchForTests(async () => ({ ok: false, status: 500, text: async () => "nope" }));
    const brain = new BrainService(await makeAdapter());
    expect((await brain.query("q")).grounded).toBe(false);
  });

  it("stats() explains that MCP serves queries when no local graph.json exists", async () => {
    __setFetchForTests(async () => ({ ok: true, status: 200, text: async () => "{}" }));
    const brain = new BrainService(await makeAdapter());
    const stats = await brain.stats();
    expect(stats.available).toBe(false);
    expect(stats.detail).toContain("sidecar");
  });

  it("explain() maps an MCP result into a NodeExplanation", async () => {
    __setFetchForTests(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          result: { content: [{ type: "text", text: "it is a service" }], nodes: [{ id: "n2", label: "Dep" }] },
        }),
    }));
    const brain = new BrainService(await makeAdapter());
    const e = await brain.explain("n1");
    expect(e?.summary).toBe("it is a service");
    expect(e?.neighbors[0].id).toBe("n2");
  });

  it("path() maps an MCP shortest_path result", async () => {
    __setFetchForTests(async (_u, init) => {
      expect(JSON.parse(init!.body!).params.name).toBe("shortest_path");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: { path: [{ id: "a" }, { id: "b" }] } }),
      };
    });
    const brain = new BrainService(await makeAdapter());
    expect((await brain.path("a", "b")).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("GraphifyAdapter — transport selection", () => {
  it("reports 'absent' with an actionable detail when nothing is configured", async () => {
    const s = await (await makeAdapter()).status();
    expect(s.mode).toBe("absent");
    expect(s.detail).toMatch(/graphify \.|make brain/);
  });

  it("prefers MCP over the local graph when GRAPHIFY_MCP_URL is set", async () => {
    await writeGraph([{ id: "a" }], []);
    process.env.GRAPHIFY_MCP_URL = "http://sidecar:8765/mcp/";
    const adapter = await makeAdapter();
    const s = await adapter.status();
    expect(s.mode).toBe("mcp");
    expect(s.mcpUrl).toBe("http://sidecar:8765/mcp"); // trailing slash trimmed
  });

  it("reports 'local' when a graph exists and no sidecar is configured", async () => {
    await writeGraph([{ id: "a" }], []);
    expect((await (await makeAdapter()).status()).mode).toBe("local");
  });

  it("only warns once per failure reason (a brainless boot must not spam)", async () => {
    const adapter = await makeAdapter();
    const warn = vi.spyOn((adapter as unknown as { logger: { warn: (m: string) => void } }).logger, "warn");
    await adapter.readGraph();
    await adapter.readGraph();
    await adapter.readGraph();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
