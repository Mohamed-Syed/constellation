/**
 * The Brain — portal-side client for the memory / knowledge-graph subsystem.
 *
 * CONTRACT (docs/BRAIN.md §5, owned by Nova in `apps/api/src/core/memory`):
 *   POST /api/brain/query    (Bearer; `core:brain:read`)  → { answer, provenance[] }
 *   GET  /api/brain/graph    (Bearer)                     → graph.json
 *   GET  /api/brain/stats    (Bearer)                     → { nodes, edges, lastBuiltAt }
 *   POST /api/brain/remember (Bearer; `core:brain:write`) — not surfaced in this view yet.
 *
 * The engine is a Graphify sidecar that may not be running, and Nova's routes
 * may not be mounted yet. So EVERY function here is total: it returns a
 * discriminated result and never throws. Callers distinguish four states:
 *   "ok"            — real data
 *   "not-built"     — routes exist but the graph is empty / sidecar absent (404 on the
 *                     brain namespace, or an empty graph) → show the "brain not built yet" state
 *   "forbidden"     — 401/403, the caller lacks `core:brain:read`
 *   "unreachable"   — the API itself is down
 * Same "never crash" discipline as PrismaService (BRAIN.md §4).
 */
import { API_BASE } from "./api-base";

/** Permission gating the whole Brain surface (nav item, page, query box). */
export const BRAIN_READ_PERMISSION = "core:brain:read";
/** Permission for writing memories (`POST /api/brain/remember`) — reserved for a later slice. */
export const BRAIN_WRITE_PERMISSION = "core:brain:write";

/** A node in `graph.json`. Graphify emits varied metadata; only `id` is relied upon. */
export interface BrainNode {
  id: string;
  /** Human label; falls back to `id` when absent. */
  label?: string;
  /**
   * Node kind, e.g. "file" | "function" | "class" | "note". The API's `GraphRef`
   * calls this `kind`; raw engine graph nodes often use `type`. Accept both —
   * `nodeKind()` normalizes.
   */
  kind?: string;
  type?: string;
  /** Originating file path, when the node came from the corpus. */
  path?: string;
  [key: string]: unknown;
}

/** An edge in `graph.json`. Endpoints may be ids or `{ id }` objects depending on the exporter. */
export interface BrainEdge {
  source: string;
  target: string;
  /** Relationship kind, e.g. "imports" | "calls" | "mentions". */
  type?: string;
  [key: string]: unknown;
}

export interface BrainGraph {
  nodes: BrainNode[];
  edges: BrainEdge[];
}

/** Mirrors `MemoryStats` in `@constellation/plugin-sdk` (packages/plugin-sdk/src/memory.ts). */
export interface BrainStats {
  nodes: number;
  edges: number;
  /** ISO timestamp of the last Graphify build, or null when never built. */
  lastBuiltAt: string | null;
  /** False when no graph exists — the authoritative "brain not built yet" signal. */
  available: boolean;
  /** Markdown notes currently in the `brain/` vault (can be > 0 with no graph built). */
  vaultNotes: number;
  /** Human-readable reason when `available` is false. */
  detail?: string;
}

/** A provenance reference returned alongside a grounded answer (`GraphRef` in BRAIN.md §4). */
/** Mirrors `GraphRef` in `@constellation/plugin-sdk`; extra fields tolerated. */
export interface BrainGraphRef {
  /** Graph node id the claim is grounded in. */
  id?: string;
  nodeId?: string;
  label?: string;
  /** Source file the node came from — the thing a human actually wants to open. */
  path?: string;
  file?: string;
  /** Node kind per the SDK's `GraphRef`. */
  kind?: string;
  type?: string;
  /** Quoted supporting text, when the backend returns one. */
  snippet?: string;
  /** Relevance score, when scored. */
  score?: number;
  [key: string]: unknown;
}

export interface BrainAnswer {
  answer: string;
  provenance: BrainGraphRef[];
  grounded: boolean;
}

export type BrainResult<T> =
  | { state: "ok"; data: T }
  | { state: "not-built"; message: string }
  | { state: "forbidden"; message: string }
  | { state: "unreachable"; message: string };

const NOT_BUILT_MESSAGE =
  "The brain hasn't been built yet. Run the Graphify sidecar over the corpus (docs/ + brain/) to populate the knowledge graph.";

function authHeaders(token: string | null): HeadersInit | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

/** Map a non-OK response onto a non-"ok" BrainResult. Shared by every call below. */
function classify<T>(status: number): BrainResult<T> {
  if (status === 401 || status === 403) {
    return { state: "forbidden", message: "You don't have permission to read the brain." };
  }
  if (status === 404 || status === 501 || status === 503) {
    // 404 = the /api/brain routes aren't mounted yet (Nova's lane) or there's no
    // graph.json; 503 = the Graphify sidecar is configured but down. Both are
    // "not built" from the user's point of view, not an error to shout about.
    return { state: "not-built", message: NOT_BUILT_MESSAGE };
  }
  return { state: "unreachable", message: `The brain service returned an unexpected error (HTTP ${status}).` };
}

/** Normalize an endpoint that may be an id string or a `{ id }`-shaped object. */
function endpointId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return null;
}

/**
 * Normalize whatever `graph.json` shape arrives into `{ nodes, edges }`.
 * Graphify (and graph exporters generally) variously call the edge array
 * `edges` or `links`, so we accept both. Malformed entries are dropped rather
 * than throwing, and edges pointing at unknown nodes are discarded so the
 * layout can't reference a missing node.
 */
export function normalizeGraph(raw: unknown): BrainGraph {
  if (!raw || typeof raw !== "object") return { nodes: [], edges: [] };
  const obj = raw as { nodes?: unknown; edges?: unknown; links?: unknown };

  const nodes: BrainNode[] = Array.isArray(obj.nodes)
    ? obj.nodes
        .map((n): BrainNode | null => {
          if (typeof n === "string") return { id: n };
          if (!n || typeof n !== "object") return null;
          const id = (n as { id?: unknown }).id;
          if (typeof id !== "string" || id.length === 0) return null;
          return n as BrainNode;
        })
        .filter((n): n is BrainNode => n !== null)
    : [];

  const known = new Set(nodes.map((n) => n.id));
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : Array.isArray(obj.links) ? obj.links : [];
  const edges: BrainEdge[] = rawEdges
    .map((e): BrainEdge | null => {
      if (!e || typeof e !== "object") return null;
      const rec = e as Record<string, unknown>;
      const source = endpointId(rec.source ?? rec.from);
      const target = endpointId(rec.target ?? rec.to);
      if (!source || !target) return null;
      if (!known.has(source) || !known.has(target)) return null;
      if (source === target) return null; // self-loops add nothing to the layout
      return { ...rec, source, target } as BrainEdge;
    })
    .filter((e): e is BrainEdge => e !== null);

  return { nodes, edges };
}

/** `GET /api/brain/graph` — the graph.json backing the force-directed view. */
export async function fetchBrainGraph(token: string | null): Promise<BrainResult<BrainGraph>> {
  if (!token) return { state: "forbidden", message: "You must be signed in to read the brain." };
  try {
    const res = await fetch(`${API_BASE}/brain/graph`, { cache: "no-store", headers: authHeaders(token) });
    if (!res.ok) return classify<BrainGraph>(res.status);
    // The API answers 200 with an EMPTY graph + `meta.detail` when there's no
    // build yet (verified live 2026-08-02) rather than 404ing, so the empty case
    // is the primary "not built" path — and its own `detail` is a far better
    // message than our generic one (it names the missing graph.json path).
    const body = (await res.json()) as { meta?: { available?: boolean; detail?: string } } | null;
    const graph = normalizeGraph(body);
    const detail = typeof body?.meta?.detail === "string" ? body.meta.detail : null;
    if (body?.meta?.available === false || graph.nodes.length === 0) {
      return { state: "not-built", message: detail ?? NOT_BUILT_MESSAGE };
    }
    return { state: "ok", data: graph };
  } catch {
    return { state: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/** `GET /api/brain/stats` — node/edge counts + last build time. */
export async function fetchBrainStats(token: string | null): Promise<BrainResult<BrainStats>> {
  if (!token) return { state: "forbidden", message: "You must be signed in to read the brain." };
  try {
    const res = await fetch(`${API_BASE}/brain/stats`, { cache: "no-store", headers: authHeaders(token) });
    if (!res.ok) return classify<BrainStats>(res.status);
    const body = (await res.json()) as Partial<BrainStats> | null;
    const nodes = typeof body?.nodes === "number" ? body.nodes : 0;
    const edges = typeof body?.edges === "number" ? body.edges : 0;
    const lastBuiltAt = typeof body?.lastBuiltAt === "string" ? body.lastBuiltAt : null;
    const available = body?.available === true;
    const vaultNotes = typeof body?.vaultNotes === "number" ? body.vaultNotes : 0;
    const detail = typeof body?.detail === "string" ? body.detail : undefined;
    return { state: "ok", data: { nodes, edges, lastBuiltAt, available, vaultNotes, detail } };
  } catch {
    return { state: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/**
 * `POST /api/brain/query` — a grounded answer plus the graph refs it came from.
 * An answer with no provenance is surfaced as-is (the UI flags it) rather than
 * being dressed up: an ungrounded answer is exactly what BRAIN.md's
 * "honest-abstain" discipline wants visible.
 */
export async function askBrain(question: string, token: string | null): Promise<BrainResult<BrainAnswer>> {
  if (!token) return { state: "forbidden", message: "You must be signed in to query the brain." };
  try {
    const res = await fetch(`${API_BASE}/brain/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authHeaders(token) as Record<string, string>) },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) return classify<BrainAnswer>(res.status);
    const body = (await res.json()) as { answer?: unknown; provenance?: unknown; grounded?: unknown };
    const answer = typeof body.answer === "string" ? body.answer : "";
    const provenance = Array.isArray(body.provenance)
      ? (body.provenance.filter((p) => p && typeof p === "object") as BrainGraphRef[])
      : [];
    return { state: "ok", data: { answer, provenance, grounded: body.grounded === true } };
  } catch {
    return { state: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/** Best-effort display label for a provenance ref (prefers a file path — the openable thing). */
export function refLabel(ref: BrainGraphRef): string {
  return ref.label ?? ref.path ?? ref.file ?? ref.id ?? ref.nodeId ?? "unknown source";
}

/** The graph node id a provenance ref points at, if any (used to highlight it in the graph). */
export function refNodeId(ref: BrainGraphRef): string | null {
  return ref.nodeId ?? ref.id ?? null;
}

/**
 * The kind/type of a node or ref, whichever field the producer used. The SDK's
 * `GraphRef` says `kind`; a raw engine `graph.json` node usually says `type`.
 * Accepting both keeps the view working across either surface.
 */
export function nodeKind(value: { kind?: string; type?: string }): string | undefined {
  return value.kind ?? value.type;
}
