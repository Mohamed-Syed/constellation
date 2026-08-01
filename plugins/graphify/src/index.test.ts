import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@constellation/plugin-sdk";
import plugin, {
  __setFetchForTests,
  flattenMcpContent,
  parseRpcBody,
  resolveBaseUrl,
  type HttpRequestInit,
  type HttpResponse,
} from "./index.js";

/**
 * Unit tests for the Graphify MCP adapter. NO REAL NETWORK — every test injects
 * a fake fetch. These assert the JSON-RPC 2.0 / MCP Streamable-HTTP wire shape:
 * `tools/call` with `{ name, arguments }`, and `{ content: [...] }` responses.
 */

const BASE = "http://graphify.test/mcp";

function makeCtx(settings: Record<string, unknown> = {}): PluginContext {
  return {
    pluginId: "graphify",
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as never,
    config: {
      get: <T>(key: string) => settings[key] as T | undefined,
      getOrThrow: <T>(key: string) => settings[key] as T,
      isFeatureEnabled: () => false,
    },
    events: { emit: vi.fn(), on: vi.fn(), onPlatform: vi.fn() },
    getPrincipal: () => undefined,
  } as unknown as PluginContext;
}

const configured = () => makeCtx({ baseUrl: BASE });

function res(body: unknown, status = 200, asText?: string): HttpResponse {
  const text = asText ?? JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text };
}

interface Call {
  url: string;
  init?: HttpRequestInit;
}

function fakeFetch(handler: (call: Call, n: number) => HttpResponse) {
  const calls: Call[] = [];
  let n = 0;
  __setFetchForTests(async (url, init) => {
    calls.push({ url, init });
    return handler({ url, init }, n++);
  });
  return calls;
}

/** Nth recorded call, asserted present — keeps strict index checks happy. */
function callAt(calls: Call[], i: number): Call {
  const c = calls[i];
  if (!c) throw new Error(`expected a fetch call at index ${i}, got ${calls.length}`);
  return c;
}

/** Parse the JSON-RPC envelope a call sent. */
const sentBody = (c: Call) => JSON.parse(c.init!.body!) as Record<string, unknown>;

beforeEach(() => {
  delete process.env.GRAPHIFY_MCP_URL;
  delete process.env.GRAPHIFY_API_KEY;
});

afterEach(() => {
  __setFetchForTests(undefined);
  vi.restoreAllMocks();
});

describe("configuration", () => {
  it("is undefined when nothing is set", () => {
    expect(resolveBaseUrl(makeCtx())).toBeUndefined();
  });

  it("prefers the setting over env and strips trailing slashes", () => {
    process.env.GRAPHIFY_MCP_URL = "http://env.test/mcp";
    expect(resolveBaseUrl(makeCtx({ baseUrl: "http://set.test/mcp//" }))).toBe("http://set.test/mcp");
  });

  it("falls back to GRAPHIFY_MCP_URL", () => {
    process.env.GRAPHIFY_MCP_URL = "http://env.test/mcp/";
    expect(resolveBaseUrl(makeCtx())).toBe("http://env.test/mcp");
  });
});

describe("not configured", () => {
  it("returns an actionable error and makes no network call", async () => {
    const calls = fakeFetch(() => res({}));
    const out = await plugin.invokeTool!("graph.query", { question: "hi" }, makeCtx());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/not configured/i);
    expect(calls).toHaveLength(0);
  });

  it("health is degraded, not down", async () => {
    const health = await plugin.health!(makeCtx());
    expect(health.status).toBe("degraded");
    expect(health.checks?.mcp).toBe("down");
  });
});

describe("argument validation (before any network call)", () => {
  const badArgCases: [string, Record<string, unknown>, RegExp][] = [
    ["graph.query", {}, /non-empty string argument "question"/],
    ["graph.related", { entity: "  " }, /non-empty string argument "entity"/],
    ["graph.ingest", {}, /non-empty string argument "source"/],
  ];
  it.each(badArgCases)(
    "rejects %s with bad args",
    async (tool: string, args: Record<string, unknown>, expected: RegExp) => {
      const calls = fakeFetch(() => res({}));
      const out = await plugin.invokeTool!(tool, args, configured());
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error).toMatch(expected);
      expect(calls).toHaveLength(0);
    },
  );

  it("rejects an undeclared tool", async () => {
    const out = await plugin.invokeTool!("graph.destroy", {}, configured());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/does not implement tool "graph.destroy"/);
  });
});

describe("MCP JSON-RPC protocol", () => {
  it("sends a well-formed tools/call and flattens the text content", async () => {
    const calls = fakeFetch(() =>
      res({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "the SDK is used by api" }] } }),
    );

    const out = await plugin.invokeTool!("graph.query", { question: "who uses the SDK?" }, configured());

    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data).toMatchObject({ tool: "query", text: "the SDK is used by api" });

    const body = sentBody(callAt(calls, 0));
    expect(callAt(calls, 0).url).toBe(BASE);
    expect(callAt(calls, 0).init?.method).toBe("POST");
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tools/call");
    expect(body.params).toMatchObject({
      name: "query",
      arguments: { question: "who uses the SDK?" },
    });
    // MCP Streamable HTTP requires accepting both content types.
    expect(callAt(calls, 0).init?.headers?.accept).toContain("text/event-stream");
  });

  it("maps each Constellation tool to its MCP tool name", async () => {
    const seen: string[] = [];
    fakeFetch((c) => {
      seen.push((sentBody(c).params as { name: string }).name);
      return res({ result: { content: [] } });
    });
    await plugin.invokeTool!("graph.query", { question: "q" }, configured());
    await plugin.invokeTool!("graph.related", { entity: "e" }, configured());
    await plugin.invokeTool!("graph.ingest", { source: "s" }, configured());
    expect(seen).toEqual(["query", "related", "ingest"]);
  });

  it("honors a per-deployment toolNames override", async () => {
    const calls = fakeFetch(() => res({ result: { content: [] } }));
    const ctx = makeCtx({ baseUrl: BASE, toolNames: { "graph.query": "search_graph" } });
    await plugin.invokeTool!("graph.query", { question: "q" }, ctx);
    expect((sentBody(callAt(calls, 0)).params as { name: string }).name).toBe("search_graph");
  });

  it("sends a bearer token when an api key is configured", async () => {
    const calls = fakeFetch(() => res({ result: { content: [] } }));
    await plugin.invokeTool!("graph.query", { question: "q" }, makeCtx({ baseUrl: BASE, apiKey: "sekret" }));
    expect(callAt(calls, 0).init?.headers?.authorization).toBe("Bearer sekret");
  });

  it("omits the auth header when no key is set", async () => {
    const calls = fakeFetch(() => res({ result: { content: [] } }));
    await plugin.invokeTool!("graph.query", { question: "q" }, configured());
    expect(callAt(calls, 0).init?.headers?.authorization).toBeUndefined();
  });

  it("surfaces a JSON-RPC error object as ok:false", async () => {
    fakeFetch(() => res({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "unknown tool" } }));
    const out = await plugin.invokeTool!("graph.query", { question: "q" }, configured());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("unknown tool");
  });

  it("treats an MCP isError result as a failure", async () => {
    fakeFetch(() => res({ result: { isError: true, content: [{ type: "text", text: "index missing" }] } }));
    const out = await plugin.invokeTool!("graph.related", { entity: "x" }, configured());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("index missing");
  });

  it("surfaces a transport-level HTTP error", async () => {
    fakeFetch(() => res({}, 503, "upstream down"));
    const out = await plugin.invokeTool!("graph.query", { question: "q" }, configured());
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain("503");
      expect(out.error).toContain("upstream down");
    }
  });

  it("never throws — a hard network failure becomes ok:false", async () => {
    __setFetchForTests(async () => {
      throw new Error("ECONNREFUSED");
    });
    const out = await plugin.invokeTool!("graph.query", { question: "q" }, configured());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("ECONNREFUSED");
  });
});

describe("SSE transport handling", () => {
  it("parses a JSON-RPC payload delivered as an SSE data frame", () => {
    const frame = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n';
    expect(parseRpcBody(frame)).toMatchObject({ result: { ok: true } });
  });

  it("parses a plain JSON body too", () => {
    expect(parseRpcBody('{"result":{"a":1}}')).toMatchObject({ result: { a: 1 } });
  });

  it("throws on an empty body", () => {
    expect(() => parseRpcBody("   ")).toThrow(/empty body/);
  });

  it("works end-to-end when the server streams the response", async () => {
    fakeFetch(() =>
      res(null, 200, 'data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"streamed"}]}}'),
    );
    const out = await plugin.invokeTool!("graph.query", { question: "q" }, configured());
    expect(out.ok).toBe(true);
    if (out.ok) expect((out.data as { text: string }).text).toBe("streamed");
  });
});

describe("content flattening", () => {
  it("joins multiple text parts and ignores non-text parts", () => {
    expect(
      flattenMcpContent({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }),
    ).toEqual({ text: "a\nb", isError: false });
  });

  it("tolerates a missing/!array content field", () => {
    expect(flattenMcpContent({})).toEqual({ text: "", isError: false });
    expect(flattenMcpContent(undefined)).toEqual({ text: "", isError: false });
  });
});

describe("health against a configured server", () => {
  it("is ok and reports the server tool count via tools/list", async () => {
    const calls = fakeFetch(() => res({ result: { tools: [{ name: "query" }, { name: "ingest" }] } }));
    const health = await plugin.health!(configured());
    expect(health.status).toBe("ok");
    expect(health.detail).toContain("2 server tools");
    expect(sentBody(callAt(calls, 0)).method).toBe("tools/list");
  });

  it("is down when the server returns a JSON-RPC error", async () => {
    fakeFetch(() => res({ error: { message: "not initialized" } }));
    const health = await plugin.health!(configured());
    expect(health.status).toBe("down");
    expect(health.detail).toContain("not initialized");
  });

  it("is down (not throwing) when unreachable", async () => {
    __setFetchForTests(async () => {
      throw new Error("ETIMEDOUT");
    });
    const health = await plugin.health!(configured());
    expect(health.status).toBe("down");
    expect(health.detail).toContain("ETIMEDOUT");
  });
});
