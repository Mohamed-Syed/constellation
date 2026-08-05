import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  GraphJson,
  GraphRef,
  MemoryAnswer,
  MemoryNote,
  MemoryStats,
  NodeExplanation,
  PluginMemory,
} from "@constellation/plugin-sdk";
import { GraphifyAdapter } from "./graphify.adapter.js";

/**
 * BrainService — the platform's persistent memory (docs/BRAIN.md §4).
 *
 * Two halves:
 *  - **Write:** `remember()` appends a timestamped markdown note to the
 *    `brain/` vault. This half works with NO engine at all — the vault is just
 *    files, and `graphify watch` (Atlas's sidecar) picks them up on its own
 *    schedule. Memory therefore survives a brain that isn't built yet.
 *  - **Read:** `query/explain/path/stats/graph` delegate to
 *    {@link GraphifyAdapter}. When no graph and no sidecar exist, they return
 *    honest empty/ungrounded results instead of throwing.
 *
 * ## Honest abstain
 * `query()` never fabricates. With no engine it answers "brain not built yet",
 * `grounded: false`, and (helpfully) a literal substring scan of the vault so
 * a fresh install still gets *something* back — clearly labelled as a
 * vault text match, not a graph-grounded answer.
 *
 * ## Never crash
 * Every path is try/caught to a degraded value. A read-only filesystem, an
 * absent vault, a broken sidecar — the API stays up and says so.
 */
@Injectable()
export class BrainService implements PluginMemory {
  private readonly logger = new Logger(BrainService.name);
  /** Absolute path of the markdown vault. */
  readonly vaultDir: string;
  private warnedVault = false;
  private readonly ollamaUrl: string;
  private readonly embedModel: string;
  private indexCache: { at: number; docs: Array<{ id: string; label: string; vector: number[] }> } | null = null;

  constructor(
    private readonly graphify: GraphifyAdapter,
    @Optional() private readonly config?: ConfigService,
  ) {
    this.vaultDir =
      process.env.BRAIN_VAULT_DIR?.trim() || path.join(this.graphify.corpusRoot, "brain");
    this.ollamaUrl = config?.get("OLLAMA_BASE_URL", "http://localhost:11434") ?? "http://localhost:11434";
    this.embedModel = process.env.BRAIN_EMBED_MODEL?.trim() || "nomic-embed-text";
  }

  // ------------------------------------------------------------- write

  /**
   * Append a note to the vault as markdown.
   *
   * One file per day per source (`brain/notes/YYYY-MM-DD.md`) rather than a
   * file per note: fewer inodes for `graphify watch` to churn on, and the
   * daily file reads like a log. Each entry is a `##` heading + front-matter-ish
   * bullet line so the graph engine can pick up tags/source as text.
   */
  async remember(note: MemoryNote): Promise<void> {
    const title = (note.title ?? "").trim() || "Untitled memory";
    const body = (note.body ?? "").trim();
    const tags = (note.tags ?? []).map((t) => t.trim()).filter(Boolean);
    const source = (note.source ?? "unknown").trim();
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const file = path.join(this.vaultDir, "notes", `${day}.md`);

    const entry =
      `\n## ${title}\n\n` +
      `- **when:** ${now.toISOString()}\n` +
      `- **source:** ${source}\n` +
      (tags.length ? `- **tags:** ${tags.map((t) => `#${t}`).join(" ")}\n` : "") +
      `\n${body}\n`;

    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      let header = "";
      try {
        await fs.access(file);
      } catch {
        header = `# Brain notes — ${day}\n\n> Appended by the Constellation brain (\`POST /api/brain/remember\`).\n`;
      }
      await fs.appendFile(file, header + entry, "utf8");
      this.logger.log(`remembered "${title}" -> ${file}`);
    } catch (err) {
      // A vault we cannot write to is a degraded brain, not a failed request.
      this.warnVaultOnce(`Could not write memory to ${file}: ${message(err)}`);
    }
  }

  // -------------------------------------------------------------- read

  /** Ask the brain. Always resolves; check `grounded`. */
  async query(question: string): Promise<MemoryAnswer> {
    const q = (question ?? "").trim();
    if (!q) return { answer: "Ask a question.", provenance: [], grounded: false };

    try {
      const res = await this.graphify.query(q);
      if (res && res.text) {
        return { answer: res.text, provenance: res.refs, grounded: true };
      }
    } catch (err) {
      this.logger.warn(`Graph query failed, falling back to the vault: ${message(err)}`);
    }

    // No engine (or it gave nothing): honest abstain + a plain vault scan.
    const hits = await this.scanVault(q);
    const status = await this.graphify.status();
    if (hits.length === 0) {
      return {
        answer:
          status.mode === "absent"
            ? "Brain not built yet — no knowledge graph is available and nothing in the vault matches. " +
              "Build one with `graphify .` (or `make brain`), then ask again."
            : "I don't know — the knowledge graph returned nothing for that question and the vault has no match.",
        provenance: [],
        grounded: false,
      };
    }
    return {
      answer:
        "Brain not built yet — answering from a literal text match in the `brain/` vault, " +
        "NOT from the knowledge graph:\n\n" +
        hits.map((h) => `- ${h.excerpt}`).join("\n"),
      provenance: hits.map((h) => h.ref),
      grounded: false,
    };
  }

  /** Expand a node. Null when the brain can't resolve it. */
  async explain(nodeId: string): Promise<NodeExplanation | null> {
    if (!nodeId?.trim()) return null;
    try {
      return await this.graphify.explain(nodeId.trim());
    } catch (err) {
      this.logger.warn(`explain(${nodeId}) failed: ${message(err)}`);
      return null;
    }
  }

  /** Shortest path between two nodes; empty when unreachable or no graph. */
  async path(from: string, to: string): Promise<GraphRef[]> {
    if (!from?.trim() || !to?.trim()) return [];
    try {
      return (await this.graphify.path(from.trim(), to.trim())) ?? [];
    } catch (err) {
      this.logger.warn(`path(${from} -> ${to}) failed: ${message(err)}`);
      return [];
    }
  }

  /** Counts + freshness. `available: false` = brain not built yet. */
  // ------------------------------------------------------- semantic search

  /**
   * Retrieval layer (Phase 4.0 4.2 tail): SEMANTIC search over the memory —
   * the vault notes + the knowledge-graph node labels, embedded with a local
   * Ollama model (nomic-embed-text by default; BRAIN_EMBED_MODEL to change)
   * and ranked by cosine similarity. This is the pgvector/Chroma alternative
   * that ships with ZERO new infra: the embedding pass runs in-process and is
   * cached; the index lives in memory (rebuilt on demand). Honest degrade:
   * without Ollama the endpoint returns an empty list + unavailable: true.
   */
  async search(question: string, topK = 8): Promise<{ items: Array<{ id: string; label: string; score: number }>; unavailable: boolean }> {
    const q = (question ?? "").trim();
    if (!q) return { items: [], unavailable: false };
    const queryVec = await this.embedTexts([q]);
    if (!queryVec?.length) return { items: [], unavailable: true };

    const docs = await this.loadIndex();
    const scored = docs
      .map((d) => ({ id: d.id, label: d.label, score: cosineSimilarity(queryVec[0] ?? [], d.vector) }))
      .filter((d) => Number.isFinite(d.score) && d.score > 0.16)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return { items: scored.map((d) => ({ id: d.id, label: d.label, score: Number(d.score.toFixed(4)) })), unavailable: false };
  }

  /** Embed texts via the local Ollama /api/embed (batched 64). Null when unavailable. */
  private async embedTexts(texts: string[]): Promise<number[][] | null> {
    const out: number[][] = [];
    try {
      for (let i = 0; i < texts.length; i += 64) {
        const chunk = texts.slice(i, i + 64);
        const res = await fetch(`${this.ollamaUrl}/api/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.embedModel, input: chunk }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { embeddings?: unknown };
        if (!Array.isArray(body.embeddings)) return null;
        out.push(...(body.embeddings as number[][]));
      }
      return out;
    } catch {
      return null;
    }
  }

  /** Vault notes (## sections) + graph node labels, embedded lazily (5-min cache). */
  private async loadIndex(): Promise<Array<{ id: string; label: string; vector: number[] }>> {
    if (this.indexCache && Date.now() - this.indexCache.at < 5 * 60_000) return this.indexCache.docs;

    const texts: Array<{ id: string; label: string; text: string }> = [];
    try {
      const notesDir = path.join(this.vaultDir, "notes");
      const files = await fs.readdir(notesDir).catch(() => []);
      for (const file of files.filter((f) => f.endsWith(".md"))) {
        const raw = await fs.readFile(path.join(notesDir, file), "utf8").catch(() => "");
        for (const section of raw.split(/\n##\s+/).filter(Boolean)) {
          const label = section.split("\n")[0]?.slice(0, 80) ?? file;
          texts.push({ id: `vault:${file}:${label}`, label, text: section.slice(0, 1200) });
        }
      }
    } catch {
      /* vault unreadable → graph-only index */
    }

    const graph = await this.graphify.readGraph().catch(() => null);
    const nodes = graph?.json?.nodes ?? [];
    const seen = new Set<string>();
    for (const node of nodes) {
      const label = String((node as Record<string, unknown>).label ?? (node as Record<string, unknown>).id ?? "");
      if (!label || seen.has(label)) continue;
      seen.add(label);
      texts.push({ id: `graph:${label}`, label, text: label });
    }

    const vectors = await this.embedTexts(texts.map((t) => t.text));
    if (!vectors || vectors.length !== texts.length) {
      this.indexCache = { at: Date.now(), docs: [] };
      return [];
    }
    const docs = texts.map((t, i) => ({ id: t.id, label: t.label, vector: vectors[i] ?? [] }));
    this.indexCache = { at: Date.now(), docs };
    return docs;
  }

  // --------------------------------------------------------------- stats

  async stats(): Promise<MemoryStats> {
    const vaultNotes = await this.countVaultNotes();
    try {
      const graph = await this.graphify.readGraph();
      if (!graph) {
        const status = await this.graphify.status();
        return {
          nodes: 0,
          edges: 0,
          lastBuiltAt: null,
          available: false,
          vaultNotes,
          detail:
            status.mode === "mcp"
              ? `No local graph.json at ${status.graphPath}; the MCP sidecar at ${status.mcpUrl} serves queries.`
              : (status.detail ?? "brain not built yet"),
        };
      }
      return {
        nodes: graph.json.nodes.length,
        edges: graph.json.edges.length,
        lastBuiltAt: graph.lastBuiltAt,
        available: true,
        vaultNotes,
      };
    } catch (err) {
      return {
        nodes: 0,
        edges: 0,
        lastBuiltAt: null,
        available: false,
        vaultNotes,
        detail: `stats unavailable: ${message(err)}`,
      };
    }
  }

  /** The raw graph for the portal. Empty graph (not an error) when absent. */
  async graph(): Promise<GraphJson> {
    try {
      const graph = await this.graphify.readGraph();
      if (graph) return graph.json;
    } catch (err) {
      this.logger.warn(`graph() failed: ${message(err)}`);
    }
    const status = await this.graphify.status();
    return {
      nodes: [],
      edges: [],
      meta: { available: false, detail: status.detail ?? "brain not built yet" },
    };
  }

  // ------------------------------------------------------------ vault

  /** Count `.md` files in the vault (recursively). 0 when there's no vault. */
  private async countVaultNotes(): Promise<number> {
    const files = await this.vaultFiles();
    return files.length;
  }

  private async vaultFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 5) return;
      let entries: Array<{ name: string; isDirectory(): boolean }>;
      try {
        entries = (await fs.readdir(dir, { withFileTypes: true })) as unknown as Array<{
          name: string;
          isDirectory(): boolean;
        }>;
      } catch {
        return; // no vault yet — perfectly normal
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full, depth + 1);
        else if (e.name.toLowerCase().endsWith(".md")) out.push(full);
      }
    };
    await walk(this.vaultDir, 0);
    return out;
  }

  /**
   * Dumb, dependency-free substring scan of the vault. This is deliberately
   * NOT presented as a grounded answer — it exists so a brand-new install with
   * no graph still returns something useful instead of a dead end.
   */
  private async scanVault(question: string): Promise<Array<{ excerpt: string; ref: GraphRef }>> {
    const terms = question
      .toLowerCase()
      .split(/[^a-z0-9_-]+/)
      .filter((t) => t.length > 2);
    if (terms.length === 0) return [];
    const results: Array<{ excerpt: string; ref: GraphRef; score: number }> = [];
    for (const file of (await this.vaultFiles()).slice(0, 500)) {
      let text: string;
      try {
        text = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const lower = line.toLowerCase();
        const score = terms.filter((t) => lower.includes(t)).length;
        if (score === 0) continue;
        results.push({
          score,
          excerpt: `${path.relative(this.vaultDir, file)}:${i + 1} — ${line.trim().slice(0, 240)}`,
          ref: {
            id: `${path.relative(this.vaultDir, file)}:${i + 1}`,
            label: path.basename(file),
            kind: "vault-note",
            path: file,
            score: score / terms.length,
          },
        });
      }
    }
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ excerpt, ref }) => ({ excerpt, ref }));
  }

  private warnVaultOnce(msg: string): void {
    if (this.warnedVault) return;
    this.warnedVault = true;
    this.logger.warn(msg);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Cosine similarity between two vectors (empty vectors → 0). Exported for tests. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined || bv === undefined) continue;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
