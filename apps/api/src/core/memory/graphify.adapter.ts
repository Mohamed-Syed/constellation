import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import type { GraphJson, GraphRef, NodeExplanation } from "@constellation/plugin-sdk";

/**
 * GraphifyAdapter — the ONLY thing in the platform that knows how Graphify is
 * actually reached. `BrainService` talks to this interface; swapping the
 * transport (first-cut file+CLI → full MCP client) changes nothing above it.
 *
 * ## Two transports, in preference order (docs/BRAIN.md §4)
 * 1. **MCP** (`GRAPHIFY_MCP_URL`) — JSON-RPC 2.0 `tools/call` against the
 *    sidecar's Streamable-HTTP endpoint. Same dependency-free approach the
 *    `plugins/graphify` capability uses: MCP over HTTP is just POSTed JSON.
 * 2. **Local first cut** — read `graphify-out/graph.json` for stats/graph and
 *    shell `graphify query "..."` for questions. Works with nothing but the
 *    CLI on PATH and a built graph on disk.
 *
 * ## Never crash (the PrismaService discipline)
 * Every method resolves. No graph on disk, no CLI installed, sidecar down,
 * malformed JSON — all become a `null`/empty result plus a one-time warn, so a
 * platform booted without a brain behaves exactly like one booted without a
 * database: degraded, honest, and up.
 */

/** How the adapter is currently reaching (or failing to reach) Graphify. */
export interface AdapterStatus {
  mode: "mcp" | "local" | "absent";
  /** Absolute path of the graph.json the local mode reads. */
  graphPath: string;
  /** MCP endpoint when configured. */
  mcpUrl?: string;
  /** Human-readable reason when nothing is reachable. */
  detail?: string;
}

export interface RawGraph {
  json: GraphJson;
  /** ISO mtime of graph.json — treated as "last built at". */
  lastBuiltAt: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_GRAPH_BYTES = 64 * 1024 * 1024; // refuse to slurp a pathological graph

/** Minimal fetch surface (workspace lib is ES2022, no DOM types). */
interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}
type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<HttpResponse>;

/** Shell seam so tests never spawn a real process. */
export type ShellLike = (
  cmd: string,
  args: string[],
  timeoutMs: number,
) => Promise<{ code: number; stdout: string; stderr: string }>;

let fetchImpl: FetchLike | undefined;
let shellImpl: ShellLike | undefined;

/** Test seam: override the HTTP client. Pass `undefined` to restore global fetch. */
export function __setFetchForTests(fn: FetchLike | undefined): void {
  fetchImpl = fn;
}
/** Test seam: override the process runner. Pass `undefined` to restore spawn. */
export function __setShellForTests(fn: ShellLike | undefined): void {
  shellImpl = fn;
}

function http(): FetchLike {
  return fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
}

const defaultShell: ShellLike = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { shell: process.platform === "win32" });
    } catch (err) {
      // ENOENT on a missing binary can throw synchronously on some platforms.
      resolve({ code: -1, stdout: "", stderr: asMessage(err) });
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: -1, stdout, stderr: "graphify CLI timed out" });
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });

function shell(): ShellLike {
  return shellImpl ?? defaultShell;
}

function asMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "request timed out";
    return err.message;
  }
  return String(err);
}

let requestId = 0;

@Injectable()
export class GraphifyAdapter {
  private readonly logger = new Logger(GraphifyAdapter.name);
  /** Warn once per distinct reason — a brainless boot must not spam the log. */
  private readonly warned = new Set<string>();

  /** Absolute path to `graphify-out/graph.json`. */
  readonly graphPath: string;
  /** MCP endpoint, when configured. */
  readonly mcpUrl?: string;
  private readonly timeoutMs: number;
  private readonly cliBin: string;
  private readonly corpusDir: string;

  constructor() {
    const repoRoot = resolveRepoRoot();
    this.graphPath =
      process.env.GRAPHIFY_GRAPH_PATH?.trim() || path.join(repoRoot, "graphify-out", "graph.json");
    this.corpusDir = process.env.BRAIN_CORPUS_DIR?.trim() || repoRoot;
    const url = process.env.GRAPHIFY_MCP_URL?.trim();
    this.mcpUrl = url ? url.replace(/\/+$/, "") : undefined;
    this.timeoutMs = Number(process.env.GRAPHIFY_TIMEOUT_MS ?? "") || DEFAULT_TIMEOUT_MS;
    this.cliBin = process.env.GRAPHIFY_BIN?.trim() || "graphify";
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger.warn(message);
  }

  /** Which transport is live right now. Cheap; safe to call per request. */
  async status(): Promise<AdapterStatus> {
    if (this.mcpUrl) return { mode: "mcp", graphPath: this.graphPath, mcpUrl: this.mcpUrl };
    const graph = await this.readGraph();
    if (graph) return { mode: "local", graphPath: this.graphPath };
    return {
      mode: "absent",
      graphPath: this.graphPath,
      detail:
        "brain not built yet — no graph at " +
        this.graphPath +
        " and GRAPHIFY_MCP_URL is unset. Build one with `graphify .` (or `make brain`).",
    };
  }

  /**
   * Read + parse `graphify-out/graph.json`. Returns null (never throws) when
   * the file is missing, unreadable, too large, or not valid graph JSON.
   */
  async readGraph(): Promise<RawGraph | null> {
    try {
      const stat = await fs.stat(this.graphPath);
      if (!stat.isFile()) return null;
      if (stat.size > MAX_GRAPH_BYTES) {
        this.warnOnce("too-big", `graph.json is ${stat.size} bytes — refusing to load.`);
        return null;
      }
      const parsed: unknown = JSON.parse(await fs.readFile(this.graphPath, "utf8"));
      const json = normalizeGraph(parsed);
      if (!json) {
        this.warnOnce("bad-shape", `graph.json at ${this.graphPath} has no recognizable nodes/edges.`);
        return null;
      }
      return { json, lastBuiltAt: stat.mtime.toISOString() };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === "ENOENT") {
        this.warnOnce("enoent", `Brain not built yet — no graph at ${this.graphPath}. Memory degrades to vault-only.`);
      } else {
        this.warnOnce("read-failed", `Could not read ${this.graphPath}: ${asMessage(err)}`);
      }
      return null;
    }
  }

  /**
   * Ask the graph a question.
   * MCP `query_graph` when configured, else `graphify query "<q>"`, else null
   * (caller renders the honest "brain not built yet" answer).
   */
  async query(question: string): Promise<{ text: string; refs: GraphRef[] } | null> {
    if (this.mcpUrl) {
      const res = await this.callMcp("query_graph", { question, query: question });
      if (res !== null) return { text: extractText(res) || "(no answer)", refs: extractRefs(res) };
      return null;
    }
    const out = await this.runCli(["query", question]);
    if (out !== null) {
      return { text: out.trim() || "(no answer)", refs: refsFromCliOutput(out) };
    }
    // No MCP sidecar and no CLI in this image (the normal containerized case):
    // answer straight from graph.json, the same local fallback explain()/path()
    // use. Without this, a fully-built graph still degraded to a vault scan.
    return this.queryLocalGraph(question);
  }

  /**
   * Local (no-MCP, no-CLI) question answering over `graph.json`: score nodes by
   * how well their label/path matches the question's terms, then describe the
   * best matches and how they connect. Grounded — every ref is a real node.
   */
  private async queryLocalGraph(question: string): Promise<{ text: string; refs: GraphRef[] } | null> {
    const graph = await this.readGraph();
    if (!graph) return null;

    const terms = tokenize(question);
    if (terms.length === 0) return null;

    const scored = graph.json.nodes
      .map((n) => {
        const hay = `${String(n.label ?? n.name ?? n.id ?? "")} ${String(n.path ?? n.file ?? n.source_file ?? "")}`.toLowerCase();
        const score = terms.reduce((acc, t) => (hay.includes(t) ? acc + 1 : acc), 0);
        return { n, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    if (scored.length === 0) return null;

    // Degree + neighbour names give the answer some actual connective tissue.
    const idOf = (n: Record<string, unknown>) => String(n.id ?? n.name ?? "");
    const neighborsOf = (id: string) =>
      graph.json.edges
        .filter((e) => String(e.source ?? e.from ?? "") === id || String(e.target ?? e.to ?? "") === id)
        .map((e) =>
          String(e.source ?? e.from ?? "") === id ? String(e.target ?? e.to ?? "") : String(e.source ?? e.from ?? ""),
        );

    const lines = scored.map(({ n, score }) => {
      const id = idOf(n);
      const nb = neighborsOf(id);
      const preview = nb.slice(0, 5).join(", ");
      return (
        `- **${String(n.label ?? n.name ?? id)}**` +
        `${n.source_file ?? n.path ?? n.file ? ` (${String(n.source_file ?? n.path ?? n.file)})` : ""}` +
        ` — ${nb.length} connection(s)${preview ? `: ${preview}${nb.length > 5 ? ", …" : ""}` : ""}` +
        ` [match ${score}/${terms.length}]`
      );
    });

    const text =
      `From the knowledge graph (${graph.json.nodes.length} nodes, ${graph.json.edges.length} edges), ` +
      `the nodes most related to your question:\n\n${lines.join("\n")}`;

    const refs = scored.map(({ n, score }) => ({ ...toRef(n), score: score / terms.length }));
    return { text, refs };
  }

  /** Expand one node. MCP `explain`, else null. */
  async explain(nodeId: string): Promise<NodeExplanation | null> {
    if (this.mcpUrl) {
      const res = await this.callMcp("explain", { node_id: nodeId, nodeId });
      if (res !== null) {
        return {
          node: { id: nodeId, label: nodeId },
          summary: extractText(res) || "(no explanation)",
          neighbors: extractRefs(res),
        };
      }
      return null;
    }
    // Local fallback: derive an explanation straight from graph.json.
    const graph = await this.readGraph();
    if (!graph) return null;
    const node = graph.json.nodes.find((n) => String(n.id ?? n.name ?? "") === nodeId);
    if (!node) return null;
    const neighbors = graph.json.edges
      .filter((e) => String(e.source ?? e.from ?? "") === nodeId || String(e.target ?? e.to ?? "") === nodeId)
      .map((e) => {
        const other =
          String(e.source ?? e.from ?? "") === nodeId
            ? String(e.target ?? e.to ?? "")
            : String(e.source ?? e.from ?? "");
        return { id: other, label: other, kind: e.type ? String(e.type) : undefined };
      })
      .slice(0, 50);
    return { node: toRef(node), summary: describeNode(node, neighbors.length), neighbors };
  }

  /** Shortest path between two nodes. MCP `shortest_path`, else BFS over graph.json. */
  async path(from: string, to: string): Promise<GraphRef[] | null> {
    if (this.mcpUrl) {
      const res = await this.callMcp("shortest_path", { from, to, source: from, target: to });
      if (res !== null) return extractRefs(res);
      return null;
    }
    const graph = await this.readGraph();
    if (!graph) return null;
    return bfsPath(graph.json, from, to);
  }

  /** Run the Graphify CLI; null when it's missing or fails. */
  private async runCli(args: string[]): Promise<string | null> {
    const { code, stdout, stderr } = await shell()(this.cliBin, args, this.timeoutMs).catch((err) => ({
      code: -1,
      stdout: "",
      stderr: asMessage(err),
    }));
    if (code !== 0) {
      this.warnOnce(
        "cli-failed",
        `graphify CLI unavailable or failed (\`${this.cliBin} ${args[0]}\`): ${stderr.trim() || `exit ${code}`}. ` +
          `Memory answers will be ungrounded until a graph/sidecar exists.`,
      );
      return null;
    }
    return stdout;
  }

  /**
   * One MCP `tools/call`. Returns the raw result, or null on any failure —
   * an unreachable sidecar is a degraded brain, not a 500 for the caller.
   *
   * Both snake_case and camelCase arg spellings are sent because Graphify's
   * MCP tool schemas differ slightly by version; unknown keys are ignored by
   * a JSON-Schema-validating server.
   */
  private async callMcp(tool: string, args: Record<string, unknown>): Promise<unknown | null> {
    const url = this.mcpUrl;
    if (!url) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await http()(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++requestId,
          method: "tools/call",
          params: { name: tool, arguments: args },
        }),
        signal: controller.signal,
      });
      const body = await res.text();
      if (!res.ok) {
        this.warnOnce("mcp-http", `Graphify MCP ${url} returned HTTP ${res.status}.`);
        return null;
      }
      const parsed = parseJsonOrSse(body);
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        const e = (parsed as { error?: { message?: string } }).error;
        this.warnOnce("mcp-rpc", `Graphify MCP error: ${e?.message ?? "unknown"}`);
        return null;
      }
      return (parsed as { result?: unknown } | null)?.result ?? null;
    } catch (err) {
      this.warnOnce("mcp-unreachable", `Graphify MCP at ${url} unreachable: ${asMessage(err)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Where the corpus lives (used by BrainService for the vault path). */
  get corpusRoot(): string {
    return this.corpusDir;
  }
}

// ---------------------------------------------------------------- helpers

/**
 * Repo root: `BRAIN_REPO_ROOT` wins, else walk up from cwd to the directory
 * holding `pnpm-workspace.yaml`, else cwd. Booting from `apps/api` (which is
 * how the API actually starts) must still find the repo-level vault.
 */
function resolveRepoRoot(): string {
  const override = process.env.BRAIN_REPO_ROOT?.trim();
  if (override) return path.resolve(override);
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const exists = require("node:fs").existsSync(path.join(dir, "pnpm-workspace.yaml"));
      if (exists) return dir;
    } catch {
      /* ignore */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Accept the several shapes Graphify has used for graph.json. */
function normalizeGraph(parsed: unknown): GraphJson | null {
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const nodes = pickArray(o, ["nodes", "vertices"]);
  const edges = pickArray(o, ["edges", "links", "relationships"]);
  if (!nodes && !edges) return null;
  const {
    nodes: _n,
    edges: _e,
    links: _l,
    vertices: _v,
    relationships: _r,
    meta: rawMeta,
    ...restMeta
  } = o;
  const meta =
    rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
      ? { ...(rawMeta as Record<string, unknown>), ...restMeta }
      : restMeta;
  return {
    nodes: nodes ?? [],
    edges: edges ?? [],
    meta: Object.keys(meta).length ? (meta as Record<string, unknown>) : undefined,
  };
}

function pickArray(o: Record<string, unknown>, keys: string[]): Array<Record<string, unknown>> | null {
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>;
  }
  return null;
}

/** MCP Streamable HTTP may answer with plain JSON or an SSE `data:` frame. */
function parseJsonOrSse(body: string): unknown | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    for (const line of trimmed.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        try {
          return JSON.parse(line.slice(5).trim());
        } catch {
          /* keep scanning */
        }
      }
    }
    return null;
  }
}

/** Pull human text out of an MCP tool result (`content: [{type:"text"}]`). */
function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const o = result as Record<string, unknown>;
  if (Array.isArray(o.content)) {
    const parts = o.content
      .map((c) => (c && typeof c === "object" ? String((c as Record<string, unknown>).text ?? "") : ""))
      .filter(Boolean);
    if (parts.length) return parts.join("\n");
  }
  for (const key of ["answer", "text", "summary", "result"]) {
    if (typeof o[key] === "string") return o[key] as string;
  }
  return "";
}

/** Pull graph references (provenance) out of an MCP tool result. */
function extractRefs(result: unknown): GraphRef[] {
  if (!result || typeof result !== "object") return [];
  const o = result as Record<string, unknown>;
  for (const key of ["provenance", "nodes", "sources", "results", "path"]) {
    const v = o[key];
    if (Array.isArray(v)) {
      return v
        .filter((x) => x && typeof x === "object")
        .map((x) => toRef(x as Record<string, unknown>))
        .slice(0, 50);
    }
  }
  return [];
}

/**
 * Split a question into meaningful lowercase search terms: drop punctuation,
 * very short tokens, and common English stopwords so "what connects the plugin
 * loader to the SDK?" scores on `plugin`, `loader`, `sdk` — not on `the`/`to`.
 */
const QUERY_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "for", "with", "at", "by",
  "from", "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "how", "what",
  "when", "where", "which", "who", "whom", "why", "this", "that", "these", "those", "it", "its",
  "as", "so", "than", "then", "there", "here", "can", "could", "should", "would", "will", "shall",
  "me", "my", "our", "we", "you", "your", "about", "into", "over", "under", "between", "connect",
  "connects", "connected", "show", "tell", "explain", "list", "get", "find",
]);

function tokenize(question: string): string[] {
  const seen = new Set<string>();
  for (const raw of question.toLowerCase().split(/[^a-z0-9_]+/)) {
    const t = raw.trim();
    if (t.length < 2 || QUERY_STOPWORDS.has(t)) continue;
    seen.add(t);
  }
  return [...seen];
}

function toRef(n: Record<string, unknown>): GraphRef {
  const id = String(n.id ?? n.node_id ?? n.name ?? n.label ?? "");
  return {
    id,
    label: String(n.label ?? n.name ?? n.title ?? id),
    kind: n.kind ? String(n.kind) : n.type ? String(n.type) : undefined,
    path: n.path ? String(n.path) : n.file ? String(n.file) : undefined,
    score: typeof n.score === "number" ? n.score : undefined,
  };
}

function describeNode(n: Record<string, unknown>, degree: number): string {
  const kind = n.kind ?? n.type ?? "node";
  const where = n.path ?? n.file;
  return `${kind} "${n.label ?? n.name ?? n.id}"${where ? ` in ${where}` : ""} — ${degree} connection(s) in the graph.`;
}

/**
 * Provenance from CLI output: any `path/to/file.ext[:line]` token we can see.
 * Best-effort — the MCP path returns structured refs and is preferred.
 */
function refsFromCliOutput(out: string): GraphRef[] {
  const seen = new Set<string>();
  const refs: GraphRef[] = [];
  const re = /([\w./\\-]+\.(?:ts|tsx|js|jsx|py|md|json|yaml|yml))(?::(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null && refs.length < 25) {
    const file = m[1];
    if (!file) continue;
    const id = m[2] ? `${file}:${m[2]}` : file;
    if (seen.has(id)) continue;
    seen.add(id);
    refs.push({ id, label: id, kind: "file", path: file });
  }
  return refs;
}

/** Breadth-first shortest path over graph.json for the local (no-MCP) mode. */
function bfsPath(graph: GraphJson, from: string, to: string): GraphRef[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const n of graph.nodes) byId.set(String(n.id ?? n.name ?? ""), n);
  if (!byId.has(from) || !byId.has(to)) return [];
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    const a = String(e.source ?? e.from ?? "");
    const b = String(e.target ?? e.to ?? "");
    if (!a || !b) continue;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); // treat as undirected for reachability
  }
  const prev = new Map<string, string>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const next of adj.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, cur);
      queue.push(next);
    }
  }
  if (to !== from && !prev.has(to)) return [];
  const chain: string[] = [to];
  for (let guard = 0; chain[0] !== from; guard++) {
    const head = chain[0];
    const p = head === undefined ? undefined : prev.get(head);
    if (!p || guard > graph.nodes.length) return [];
    chain.unshift(p);
  }
  return chain.map((id) => toRef(byId.get(id) ?? { id }));
}
