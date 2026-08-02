/**
 * Memory capability — the plugin-facing view of the platform's "brain"
 * (persistent, queryable knowledge graph; see `docs/BRAIN.md`).
 *
 * ADDITIVE (SDK 0.2.0, `manifestVersion` unchanged at 1): the capability is
 * exposed as an OPTIONAL `memory` field on `PluginContext`. A plugin written
 * against 0.1.0 keeps compiling and running unchanged; a plugin that wants
 * memory must declare `core:brain:read` / `core:brain:write` in its manifest
 * `permissions` and defensively handle `ctx.memory === undefined` (the core
 * only supplies it when the brain subsystem is mounted).
 *
 * Design rule inherited from the rest of the platform: memory NEVER throws for
 * an expected condition. A brain that has not been built yet answers with
 * `grounded: false` and an honest "brain not built yet" message rather than
 * failing the caller.
 */

/** A pointer back into the knowledge graph — how an answer is grounded. */
export interface GraphRef {
  /** Graph node id (stable within one build of the graph). */
  id: string;
  /** Human-readable label for the node. */
  label: string;
  /** Node kind as reported by the graph engine (file, symbol, note, …). */
  kind?: string;
  /** Source path/URI the node came from, when known. */
  path?: string;
  /** Engine-reported relevance for this reference, 0..1 when available. */
  score?: number;
}

/** A memory to persist into the `brain/` vault. */
export interface MemoryNote {
  title: string;
  body: string;
  tags?: string[];
  /** Who/what produced this memory (plugin id, agent name, url…). */
  source?: string;
}

/** A grounded answer to a question put to the brain. */
export interface MemoryAnswer {
  answer: string;
  provenance: GraphRef[];
  /**
   * False when the brain could not ground the answer (no graph built, engine
   * absent, or nothing relevant found). Callers should surface this honestly
   * rather than presenting an ungrounded answer as fact.
   */
  grounded: boolean;
}

/** An expanded view of one graph node. */
export interface NodeExplanation {
  node: GraphRef;
  summary: string;
  neighbors: GraphRef[];
}

/** Counts + freshness for the current graph build. */
export interface MemoryStats {
  nodes: number;
  edges: number;
  /** ISO timestamp of the last graph build, or null when never built. */
  lastBuiltAt: string | null;
  /** False when the graph is absent — the "brain not built yet" signal. */
  available: boolean;
  /** Number of markdown notes currently in the `brain/` vault. */
  vaultNotes: number;
  /** Human-readable reason when `available` is false. */
  detail?: string;
}

/** The raw graph document the portal renders (force-directed view). */
export interface GraphJson {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  /** Engine metadata passed through untouched; shape is engine-defined. */
  meta?: Record<string, unknown>;
}

/**
 * The `memory` capability handed to plugins on their `PluginContext`.
 * A subset of the core `BrainService` — read + write only, no admin surface.
 */
export interface PluginMemory {
  /** Append a note to the brain vault. Resolves even when the engine is absent. */
  remember(note: MemoryNote): Promise<void>;
  /** Ask the brain a question; always resolves (see `MemoryAnswer.grounded`). */
  query(question: string): Promise<MemoryAnswer>;
  /** Counts + freshness; returns `available: false` when no graph exists. */
  stats(): Promise<MemoryStats>;
}
