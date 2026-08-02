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

// NOTE (orchestrator, 2026-08-02): this is deliberately GRAPHIFY_PLUGIN_MCP_URL
// and NOT GRAPHIFY_MCP_URL. The latter is reserved by the CORE brain
// (apps/api/src/core/memory) — setting it there disables the graph.json
// fallback and breaks /api/brain/query when the sidecar is down. The two must
// stay decoupled, so the capability plugin gets its own variable. The legacy
// name is still honoured as a fallback for anyone who set it already.
const ENV_BASE_URL = "GRAPHIFY_PLUGIN_MCP_URL";
const ENV_BASE_URL_LEGACY = "GRAPHIFY_MCP_URL";
const ENV_API_KEY = "GRAPHIFY_API_KEY";
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Constellation tool name -> default MCP tool name.
 *
 * ## P4: corrected against the LIVE sidecar
 * The round-2 defaults (`query`/`related`/`ingest`) were guesses and match
 * NOTHING on the real server. `tools/list` against the running brain sidecar
 * (`http://127.0.0.1:8791/mcp`) reports these actual tools:
 *
 *   query_graph, get_node, get_neighbors, get_community, god_nodes,
 *   graph_stats, shortest_path, list_prs, get_pr_impact, triage_prs
 *
 * So the defaults now point at real tools. Note there is **no ingest tool**:
 * the sidecar builds and watches its graph from the mounted corpus via its
 * entrypoint (`graphify <corpus>` + `graphify watch`), not over MCP. See the
 * `graph.ingest` handling in `invokeTool` — it reports that honestly rather
 * than pretending to queue an index.
 */
const MCP_TOOL_NAMES: Record<string, string> = {
  "graph.query": "query_graph",
  "graph.related": "get_neighbors",
  "graph.ingest": "ingest",
};

/**
 * Translates our tool's arguments into the argument names the MCP server
 * actually declares. Our manifest is a stable Constellation-facing contract;
 * the server's parameter names are its own. Without this the server rejects
 * `graph.related` because it wants `label`, not `entity`.
 *
 * Unknown keys are passed through so deployment-specific extras still reach
 * the server, and `undefined` values are dropped so we never send nulls.
 */
export function mapToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rename: Record<string, string> =
    name === "graph.related" ? { entity: "label" } : {};
  // `limit` is our generic cap; the server expresses it as a token budget.
  const generic: Record<string, string> = { limit: "token_budget" };

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    const mapped = rename[key] ?? generic[key] ?? key;
    out[mapped] = value;
  }
  // get_neighbors takes no `depth`; drop it rather than trip strict validation.
  if (name === "graph.related") delete out.depth;
  return out;
}

/**
 * Cache of `tools/list` results per endpoint.
 *
 * The preflight in `invokeTool` exists to turn "server doesn't have that tool"
 * into a precise error, but re-listing on every single call would double this
 * plugin's request rate against the sidecar for no benefit — an MCP server's
 * tool set is static for the life of the process. So we list once per endpoint
 * and reuse it. A failed list is NOT cached, so a server that was down when we
 * first tried still gets preflighted once it recovers.
 */
const toolListCache = new Map<string, string[]>();

/** Test seam: clears the memoised `tools/list` results between tests. */
export function __resetToolListCacheForTests(): void {
  toolListCache.clear();
}

/**
 * After a `tools/call` failure, ask the server what it DOES have and, if our
 * tool genuinely isn't in that list, build a message that says so plainly.
 *
 * Returns `undefined` when the tool does exist (so the caller falls back to the
 * server's own error message, which is then the real explanation) or when the
 * listing itself fails (never mask one error with another).
 */
async function describeMissingTool(
  baseUrl: string,
  apiKey: string | undefined,
  timeoutMs: number,
  toolName: string,
  mcpToolName: string | undefined,
): Promise<string | undefined> {
  if (!mcpToolName) return undefined;

  let available = toolListCache.get(baseUrl);
  if (!available) {
    try {
      const listed = await rpc(baseUrl, apiKey, "tools/list", {}, timeoutMs);
      if (listed.error) return undefined;
      const tools = (listed.result as { tools?: { name?: string }[] } | undefined)?.tools;
      if (!Array.isArray(tools) || tools.length === 0) return undefined;
      available = tools.map((t) => t?.name).filter((n): n is string => !!n);
      toolListCache.set(baseUrl, available);
    } catch {
      return undefined; // listing failed too — let the original error stand
    }
  }

  if (available.includes(mcpToolName)) return undefined;

  return (
    `Graphify MCP server at ${baseUrl} does not expose a "${mcpToolName}" tool ` +
    `(needed for "${toolName}"). Available tools: ${available.join(", ")}. ` +
    (toolName === "graph.ingest"
      ? `This server builds its graph from its mounted corpus (graphify build + watch) and ` +
        `exposes no ingest tool over MCP, so there is nothing to call. `
      : "") +
    `Override the mapping with the "toolNames" setting if your server names it differently.`
  );
}

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

/** MCP endpoint URL: `baseUrl` setting → env (new name, then legacy). Undefined when unset. */
export function resolveBaseUrl(ctx: PluginContext): string | undefined {
  const fromConfig = ctx.config.get<string>("baseUrl");
  const raw =
    (fromConfig && fromConfig.trim()) ||
    process.env[ENV_BASE_URL]?.trim() ||
    process.env[ENV_BASE_URL_LEGACY]?.trim();
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
    const timeoutMs = resolveTimeoutMs(ctx);
    const apiKey = resolveApiKey(ctx);

    try {
      const body = await rpc(
        baseUrl,
        apiKey,
        "tools/call",
        { name: mcpToolName, arguments: mapToolArgs(name, args) },
        timeoutMs,
      );

      if (body.error) {
        // The server rejected the call. The overwhelmingly common cause is that
        // it simply doesn't have a tool by that name (our defaults are only
        // defaults). Spend ONE extra round trip on `tools/list` to turn an
        // opaque "unknown tool" into an actionable message naming what IS
        // available. This is the lazy path on purpose: the happy path costs no
        // extra requests, and the result is memoised per endpoint.
        const diagnosis = await describeMissingTool(baseUrl, apiKey, timeoutMs, name, mcpToolName);
        return {
          ok: false,
          error:
            diagnosis ??
            `Graphify MCP rejected "${mcpToolName}": ${body.error.message ?? "unknown error"}`,
        };
      }

      const { text, isError } = flattenMcpContent(body.result);
      if (isError) {
        return { ok: false, error: `Graphify tool "${mcpToolName}" failed: ${text || "no detail"}` };
      }

      // Some Graphify builds answer an unknown tool with a 200 + isError:FALSE
      // and the literal body "Unknown tool: <name>" (verified live 2026-08-02
      // against the sidecar for graph.ingest). Taking that at face value would
      // report a hard failure as ok:true, which is exactly the dishonest
      // degradation the agent plane must never do. Catch it explicitly.
      if (/^\s*unknown tool\b/i.test(text)) {
        return {
          ok: false,
          error:
            `Graphify MCP does not expose "${mcpToolName}" (server replied "${text.trim()}"). ` +
            `This sidecar builds its graph from its mounted corpus (graphify build + watch), ` +
            `so there is no write/ingest tool to call. Use graph.query / graph.related instead.`,
        };
      }

      ctx.logger.debug(`graphify tool "${name}" -> MCP "${mcpToolName}" succeeded`);
      return { ok: true, data: { tool: mcpToolName, text, raw: body.result } };
    } catch (err) {
      return { ok: false, error: `graphify call to "${name}" failed: ${asMessage(err)}` };
    }
  },
});
