import {
  definePlugin,
  type HealthResult,
  type PluginContext,
  type ToolResult,
} from "@constellation/plugin-sdk";

/**
 * graphify — agent-plane KNOWLEDGE GRAPH / MEMORY capability (C5, verdict §3).
 *
 * Graphify turns a codebase + docs into a queryable knowledge graph and exposes
 * it over **MCP** (Model Context Protocol). This plugin is the adapter that
 * makes those MCP tools callable as Constellation agent-plane tools, so an
 * agent gets grounded "how do these modules connect?" answers and durable
 * memory instead of guessing.
 *
 * ## Why speak MCP directly instead of adding an SDK
 * MCP's Streamable-HTTP transport is plain JSON-RPC 2.0 over POST. The three
 * calls we need — `initialize`, `tools/list`, `tools/call` — are a few dozen
 * lines. Adding `@modelcontextprotocol/sdk` would mean an install inside this
 * package plus a lockfile change; the plan says prefer ZERO new deps, so this
 * ships dependency-free on global `fetch`, exactly like browser-use.
 *
 * ## Tool mapping
 * Constellation tool  ->  MCP tool name (overridable per deployment via settings)
 *   graph.query       ->  query
 *   graph.related     ->  related
 *   graph.ingest      ->  ingest      (write — separately permissioned)
 *
 * The manifest gives reads (`graphify:query`) and writes (`graphify:ingest`)
 * DIFFERENT permissions on purpose: `PluginToolService` enforces each tool's
 * own permission, so an agent can be granted graph reads without ever being
 * able to trigger a re-index.
 *
 * Every failure path returns `{ ok: false, error }` per the SDK's `ToolResult`
 * contract — a broken upstream is data for the agent, not a plugin fault.
 */

const ENV_BASE_URL = "GRAPHIFY_MCP_URL";
const ENV_API_KEY = "GRAPHIFY_API_KEY";
const DEFAULT_TIMEOUT_MS = 60_000;

/** Constellation tool name -> default MCP tool name. */
const MCP_TOOL_NAMES: Record<string, string> = {
  "graph.query": "query",
  "graph.related": "related",
  "graph.ingest": "ingest",
};

/** Required string arg per tool, validated before any network call. */
const REQUIRED_ARGS: Record<string, string> = {
  "graph.query": "question",
  "graph.related": "entity",
  "graph.ingest": "source",
};

/**
 * Minimal structural fetch types — the workspace `lib` is ES2022 with no DOM
 * and `@types/node` exposes no usable global `Response`/`RequestInit`, so we
 * declare the small surface we touch. Keeps this plugin dep-free and DOM-free,
 * and doubles as the contract the test fakes implement.
 */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

type FetchLike = (input: string, init?: HttpRequestInit) => Promise<HttpResponse>;
let fetchImpl: FetchLike | undefined;

/** Test seam: override the HTTP client so no unit test touches the network. */
export function __setFetchForTests(fn: FetchLike | undefined): void {
  fetchImpl = fn;
}

function http(): FetchLike {
  return fetchImpl ?? (globalThis.fetch as FetchLike);
}

/** MCP endpoint URL: `baseUrl` setting → env. Undefined when unset. */
export function resolveBaseUrl(ctx: PluginContext): string | undefined {
  const fromConfig = ctx.config.get<string>("baseUrl");
  const raw = (fromConfig && fromConfig.trim()) || process.env[ENV_BASE_URL]?.trim();
  return raw ? raw.replace(/\/+$/, "") : undefined;
}

function resolveApiKey(ctx: PluginContext): string | undefined {
  const fromConfig = ctx.config.get<string>("apiKey");
  const raw = (fromConfig && fromConfig.trim()) || process.env[ENV_API_KEY]?.trim();
  return raw || undefined;
}

function resolveTimeoutMs(ctx: PluginContext): number {
  const v = ctx.config.get<number>("timeoutMs");
  return typeof v === "number" && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

const notConfigured = (): ToolResult => ({
  ok: false,
  error:
    `graphify is not configured: set the "baseUrl" plugin setting or the ${ENV_BASE_URL} ` +
    `environment variable to the URL of a Graphify MCP server (Streamable HTTP).`,
});

function asMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "request timed out";
    return err.message;
  }
  return String(err);
}

let requestId = 0;

/** A JSON-RPC 2.0 response, as much of it as we interpret. */
interface JsonRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

/**
 * One JSON-RPC call against the MCP endpoint.
 *
 * MCP's Streamable HTTP transport allows the server to reply with either
 * `application/json` or an SSE stream; we request both and parse the SSE
 * `data:` frame when that's what comes back, so this works against servers
 * that always stream.
 */
async function rpc(
  url: string,
  apiKey: string | undefined,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<JsonRpcResponse> {
  requestId += 1;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const res = await http()(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `MCP server returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    );
  }

  const raw = await res.text();
  return parseRpcBody(raw);
}

/** Parses a JSON-RPC body that may be plain JSON or an SSE `data:` frame. */
export function parseRpcBody(raw: string): JsonRpcResponse {
  const text = raw.trim();
  if (!text) throw new Error("MCP server returned an empty body");

  if (text.startsWith("event:") || text.startsWith("data:")) {
    const line = text
      .split(/\r?\n/)
      .find((l) => l.startsWith("data:"));
    if (!line) throw new Error("MCP SSE response contained no data frame");
    return JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
  }
  return JSON.parse(text) as JsonRpcResponse;
}

/**
 * Flattens an MCP `tools/call` result into something an agent can use.
 * MCP returns `{ content: [{type:"text", text}, …], isError?: boolean }`.
 */
export function flattenMcpContent(result: unknown): { text: string; isError: boolean } {
  const r = (result ?? {}) as { content?: unknown; isError?: unknown };
  const isError = r.isError === true;
  if (!Array.isArray(r.content)) return { text: "", isError };
  const text = r.content
    .map((part) => {
      const p = (part ?? {}) as { type?: string; text?: string };
      return p.type === "text" && typeof p.text === "string" ? p.text : "";
    })
    .filter(Boolean)
    .join("\n");
  return { text, isError };
}

export default definePlugin({
  register(ctx: PluginContext): void {
    const baseUrl = resolveBaseUrl(ctx);
    if (baseUrl) {
      ctx.logger.info(`graphify registered — MCP server at ${baseUrl}`);
    } else {
      ctx.logger.warn(
        `graphify registered but NOT configured — set the "baseUrl" setting or ${ENV_BASE_URL}. ` +
          `Its tools will return a "not configured" error until then.`,
      );
    }
  },

  enable(ctx: PluginContext): void {
    ctx.logger.info("graphify enabled");
  },

  /**
   * Probes with a real MCP `tools/list`. Unconfigured is `degraded` (the plugin
   * is fine, it just has nowhere to point); configured-but-unreachable is
   * `down`, which is a genuine operational problem.
   */
  async health(ctx: PluginContext): Promise<HealthResult> {
    const baseUrl = resolveBaseUrl(ctx);
    if (!baseUrl) {
      return {
        status: "degraded",
        detail: `no Graphify MCP server configured (set "baseUrl" or ${ENV_BASE_URL})`,
        checks: { mcp: "down" },
      };
    }
    try {
      const body = await rpc(baseUrl, resolveApiKey(ctx), "tools/list", {}, 5_000);
      if (body.error) {
        return {
          status: "down",
          detail: `Graphify MCP server error: ${body.error.message ?? "unknown"}`,
          checks: { mcp: "down" },
        };
      }
      const tools = (body.result as { tools?: unknown[] } | undefined)?.tools;
      return {
        status: "ok",
        detail: `Graphify MCP reachable at ${baseUrl}${
          Array.isArray(tools) ? ` (${tools.length} server tools)` : ""
        }`,
        checks: { mcp: "ok" },
      };
    } catch (err) {
      return {
        status: "down",
        detail: `Graphify MCP at ${baseUrl} unreachable: ${asMessage(err)}`,
        checks: { mcp: "down" },
      };
    }
  },

  async invokeTool(
    name: string,
    args: Record<string, unknown>,
    ctx: PluginContext,
  ): Promise<ToolResult> {
    const requiredArg = REQUIRED_ARGS[name];
    if (!requiredArg) {
      return { ok: false, error: `graphify does not implement tool "${name}"` };
    }

    const value = args[requiredArg];
    if (typeof value !== "string" || value.trim() === "") {
      return { ok: false, error: `"${name}" requires a non-empty string argument "${requiredArg}"` };
    }

    const baseUrl = resolveBaseUrl(ctx);
    if (!baseUrl) return notConfigured();

    // Deployments can rename the server-side tools without a code change.
    const overrides = ctx.config.get<Record<string, string>>("toolNames") ?? {};
    const mcpToolName = overrides[name] ?? MCP_TOOL_NAMES[name];

    try {
      const body = await rpc(
        baseUrl,
        resolveApiKey(ctx),
        "tools/call",
        { name: mcpToolName, arguments: args },
        resolveTimeoutMs(ctx),
      );

      if (body.error) {
        return {
          ok: false,
          error: `Graphify MCP rejected "${mcpToolName}": ${body.error.message ?? "unknown error"}`,
        };
      }

      const { text, isError } = flattenMcpContent(body.result);
      if (isError) {
        return { ok: false, error: `Graphify tool "${mcpToolName}" failed: ${text || "no detail"}` };
      }

      ctx.logger.debug(`graphify tool "${name}" -> MCP "${mcpToolName}" succeeded`);
      return { ok: true, data: { tool: mcpToolName, text, raw: body.result } };
    } catch (err) {
      return { ok: false, error: `graphify call to "${name}" failed: ${asMessage(err)}` };
    }
  },
});
