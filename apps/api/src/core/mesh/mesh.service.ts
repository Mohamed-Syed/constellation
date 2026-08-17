import { createHash } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../database/prisma.service.js";

/** Health status of a mesh peer, as the topology view reports it. */
export type MeshPeerStatus = "unknown" | "up" | "down";

/** Single source of truth for the status strings (schema default + service + web mirror). */
export const PEER_STATUS = { UNKNOWN: "unknown", UP: "up", DOWN: "down" } as const;

/** A mesh peer as the API returns it (dates as ISO strings). */
export interface MeshPeerView {
  id: string;
  name: string;
  baseUrl: string;
  /** SHA-256 hex of the peer's API key — present only if one was registered. */
  apiKeyHash: string | null;
  status: MeshPeerStatus;
  lastSeen: string | null;
  lastError: string | null;
  lastProbedAt: string | null;
}

/** The mesh topology: every peer plus per-status counts for the portal. */
export interface MeshTopologyView {
  peers: MeshPeerView[];
  counts: { total: number; up: number; down: number; unknown: number };
  /**
   * The prober's configured interval (ms) — the portal derives its poll
   * cadence from this instead of hard-coding a faster-than-data rate.
   */
  probeIntervalMs: number;
}

/** Per-sweep result of the interval prober (health/logging only). */
export interface MeshSweepResult {
  /** Number of peers considered. */
  probed: number;
  /** Number that answered a 2xx health check. */
  up: number;
  /** Number that failed the health check. */
  down: number;
  /** Whether the sweep actually ran (false when the DB is absent). */
  ran: boolean;
}

/**
 * Discriminated register outcome — the portal toasts the EXACT reason instead
 * of guessing ("is the name unique and the URL valid?"). The API surface maps
 * these to proper HTTP statuses (409 duplicate / 400 invalid / 503 no-db).
 */
export type MeshPeerRegisterResult =
  | { ok: true; peer: MeshPeerView }
  | { ok: false; error: "no-db" | "invalid" | "duplicate" | "failed" };

/** Empty counts shape — the same literal is mirrored by the web client. */
export const EMPTY_COUNTS = { total: 0, up: 0, down: 0, unknown: 0 };

/**
 * Probe concurrency cap for one sweep: peers are probed in batches of this
 * size so a down fleet (each probe bounded at `probeTimeoutMs`) can't stretch
 * a single sweep past the interval cadence. `checkHealth` never throws, so a
 * batch can't abort; only the DB persists are isolated per-peer.
 */
export const PROBE_BATCH_SIZE = 8;

export interface MeshOptions {
  /** Injectable clock so tests can advance time without a real timer. */
  now?: () => Date;
  /** Override the probe interval (ms) without reading env (test seam). */
  probeIntervalMs?: number;
  /** Override the per-peer probe timeout (ms) without reading env. */
  probeTimeoutMs?: number;
}

/**
 * Injection token for `MeshOptions`. No provider is registered in MeshModule,
 * so Nest resolves it to `undefined` in production (falling back to env +
 * defaults) while offline tests pass a value directly via `new MeshService(...)`.
 * `@Optional()` keeps the unregistered provider from failing the container.
 */
export const MESH_OPTIONS = Symbol("MESH_OPTIONS");

/** Default prober cadence when MESH_PROBE_INTERVAL_MS is unset. */
export const DEFAULT_PROBE_INTERVAL_MS = 60_000;
/** Default per-peer timeout when MESH_PROBE_TIMEOUT_MS is unset. */
export const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

// Minimal structural fetch types — the repo's zero-dep stance (Node 18+
// global fetch, no DOM lib). See the capability-plugin template.
export interface HttpResponseLike {
  ok: boolean;
  status: number;
  /** Cancelable body so the prober can release keep-alive sockets. */
  body?: { cancel(): Promise<void> | void } | null;
  /** Optional JSON reader — used by cross-instance task routing (routeTask). */
  json?(): Promise<unknown>;
}
export interface HttpRequestInitLike {
  method?: string;
  signal?: AbortSignal;
  /** Optional body + headers — used by cross-instance task routing (routeTask). */
  headers?: Record<string, string>;
  body?: string;
}
export type FetchLike = (url: string, init?: HttpRequestInitLike) => Promise<HttpResponseLike>;

/** Test seam — swaps the global fetch used by the prober (no real network in tests). */
export function __setFetchForTests(fn: FetchLike | undefined): void {
  fetchImpl = fn ?? (globalThis.fetch as unknown as FetchLike);
}

let fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike;

/**
 * Phase 4.0 4.6 — Federated agent mesh (registry + health prober).
 *
 * A mesh peer is a Constellation instance (dev / staging / prod / edge site)
 * that the orchestrator may later delegate work to. This round deliberately
 * stops at REGISTRY + PROBE + TOPOLOGY: peers register with a name + base URL
 * (optionally an API key, of which only a SHA-256 hash is ever stored), the
 * prober polls `GET <baseUrl>/api/health` (2xx ⇒ `up`, anything else ⇒
 * `down` with the reason), and `GET /api/mesh/topology` exposes the fleet.
 * Cross-instance task routing (picking a peer by locality / capability / load
 * and enqueueing there) is the explicit NEXT step, not half-built here.
 *
 * DEGRADATION (matching the boot-with-no-infra invariant): with no database
 * the service never throws — register resolves `{ ok: false, error: "no-db" }`,
 * topology is empty, the interval loop does not churn (warn once). A probe
 * failure (network error, timeout, non-2xx) is a DATA update
 * (`status: "down"` + `lastError`), never an exception.
 *
 * TESTABILITY: `register` / `probe` / `probeAll` / `topology` / `remove` are
 * public seams that need no timer — tests call them directly with a fake
 * prisma delegate + stubbed fetch, and can inject `MeshOptions` via the
 * constructor. `start()`/`stop()` own the real setInterval lifecycle and are
 * not exercised by the offline suite.
 */
@Injectable()
export class MeshService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeshService.name);
  private readonly now: () => Date;
  /** ConfigService (nullable — injectable in prod, undefined in offline tests). */
  private readonly config: ConfigService | null;
  private readonly probeIntervalMs: number;
  private readonly probeTimeoutMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private probing = false;
  private warnedNoDb = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() config?: ConfigService,
    @Optional() @Inject(MESH_OPTIONS) options?: MeshOptions,
  ) {
    this.config = config ?? null;
    this.now = options?.now ?? (() => new Date());
    const intervalEnv = Number(config?.get("MESH_PROBE_INTERVAL_MS") ?? NaN);
    this.probeIntervalMs =
      options?.probeIntervalMs ??
      (Number.isFinite(intervalEnv) && intervalEnv > 0 ? intervalEnv : DEFAULT_PROBE_INTERVAL_MS);
    const timeoutEnv = Number(config?.get("MESH_PROBE_TIMEOUT_MS") ?? NaN);
    this.probeTimeoutMs =
      options?.probeTimeoutMs ??
      (Number.isFinite(timeoutEnv) && timeoutEnv > 0 ? timeoutEnv : DEFAULT_PROBE_TIMEOUT_MS);
  }

  /** The configured probe interval (ms), for health/UI. */
  get probeInterval(): number {
    return this.probeIntervalMs;
  }

  async onModuleInit(): Promise<void> {
    // NOTE: when the DB is absent at boot the prober stays OFF until the
    // process restarts — there is no loop running to re-check, so the
    // interval only starts if the DB exists NOW. This matches the
    // boot-with-no-infra invariant (warn once, never throw).
    if (!this.prisma.db) {
      this.logger.warn("Mesh prober disabled: no database configured");
      return;
    }
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /** Start the interval prober (also called from tests that want the loop). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.probeAll().catch((err) =>
        this.logger.warn(`Mesh sweep failed: ${asMessage(err)}`),
      );
    }, this.probeIntervalMs);
    this.timer.unref?.();
    this.logger.log(`Mesh prober running every ${this.probeIntervalMs}ms`);
  }

  /** Stop the interval prober. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Register a peer, hash any API key (never stored raw), then probe it
   * immediately so the topology is truthful from the first second. The
   * outcome is discriminated so callers can toast the exact failure reason.
   */
  async register(input: { name: string; baseUrl: string; apiKey?: string }): Promise<MeshPeerRegisterResult> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return { ok: false, error: "no-db" };
    }
    const name = input.name.trim();
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
    if (!name || !baseUrl) return { ok: false, error: "invalid" };
    const apiKeyHash = input.apiKey ? sha256Hex(input.apiKey) : null;
    try {
      const peer = await db.meshPeer.create({
        data: { name, baseUrl, apiKeyHash, status: PEER_STATUS.UNKNOWN },
      });
      // The immediate probe returns the fresh view already; the re-read only
      // fires when the probe's own write raced away (row vanished mid-probe).
      const view = (await this.probe(peer.id)) ?? (await this.view(peer.id));
      return view ? { ok: true, peer: view } : { ok: false, error: "failed" };
    } catch (err) {
      if ((err as { code?: string } | null)?.code === "P2002") {
        return { ok: false, error: "duplicate" };
      }
      this.logger.warn(`Mesh peer register failed: ${asMessage(err)}`);
      return { ok: false, error: "failed" };
    }
  }

  /** The whole fleet + per-status counts. Empty on no-DB — never throws. */
  async topology(): Promise<MeshTopologyView> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return { peers: [], counts: EMPTY_COUNTS, probeIntervalMs: this.probeIntervalMs };
    }
    try {
      const rows = await db.meshPeer.findMany({ orderBy: { name: "asc" } });
      const peers = rows.map(toView);
      // Single pass — the statuses are already narrowed to MeshPeerStatus by toView.
      const counts = { total: peers.length, up: 0, down: 0, unknown: 0 };
      for (const peer of peers) counts[peer.status] += 1;
      return { peers, counts, probeIntervalMs: this.probeIntervalMs };
    } catch (err) {
      this.logger.warn(`Mesh topology failed: ${asMessage(err)}`);
      return { peers: [], counts: EMPTY_COUNTS, probeIntervalMs: this.probeIntervalMs };
    }
  }

  /** Probe ONE peer and persist the outcome. Null when missing or no-DB. */
  async probe(id: string): Promise<MeshPeerView | null> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return null;
    }
    try {
      const peer = await db.meshPeer.findUnique({ where: { id } });
      if (!peer) return null;
      const outcome = await this.checkHealth(peer.baseUrl);
      const updated = await db.meshPeer.update({
        where: { id },
        data: applyProbeOutcome(peer, outcome, this.now),
      });
      return toView(updated);
    } catch (err) {
      this.logger.warn(`Mesh probe failed: ${asMessage(err)}`);
      return null;
    }
  }

  /**
   * Phase 4.0 backlog #6 — CROSS-INSTANCE TASK ROUTING (sender side).
   * Forward a task spec to a peer's `POST <baseUrl>/api/engine/mesh/forward`
   * using the shared `MESH_ROUTE_API_KEY` (cross-instance trust secret). When
   * the key is unset or the peer is unreachable, returns a discriminated
   * `{ ok:false, error }` — never throws. This instance must carry the SAME
   * `MESH_ROUTE_API_KEY` to be accepted; the receiving peer enqueues the task.
   */
  async routeTask(
    peerId: string,
    spec: { title: string; prompt: string; model?: string; maxSteps?: number },
  ): Promise<{ ok: true; taskId: string; status: string } | { ok: false; error: string }> {
    const config = this.config;
    const key = config?.get("MESH_ROUTE_API_KEY");
    const db = this.prisma.db;
    if (!db) return { ok: false, error: "no-db" };
    if (!key || typeof key !== "string" || key.length === 0) {
      return { ok: false, error: "Mesh routing is not configured (set MESH_ROUTE_API_KEY on both instances)." };
    }
    const peer = await db.meshPeer.findUnique({ where: { id: peerId } }).catch(() => null);
    if (!peer) return { ok: false, error: "peer-not-found" };
    if (!peer.baseUrl) return { ok: false, error: "peer has no base URL" };
    const url = `${peer.baseUrl.replace(/\/$/, "")}/api/engine/mesh/forward`;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mesh-route-key": key },
        body: JSON.stringify(spec),
        signal: AbortSignal.timeout(this.probeTimeoutMs),
      });
      await res.body?.cancel();
      if (!res.ok) {
        // Surface the peer's OWN error body so a downstream failure (e.g.
        // "Database not available" on a DB-less target) is actionable.
        let detail = "";
        try {
          if (res.json) detail = JSON.stringify(await res.json()).slice(0, 200);
        } catch {
          /* ignore */
        }
        return { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail}` : ""}` };
      }
      if (!res.json) return { ok: false, error: "peer returned no JSON body" };
      const payload = (await res.json()) as { taskId?: unknown; status?: unknown };
      if (typeof payload.taskId !== "string") return { ok: false, error: "peer returned no task id" };
      this.logger.log(`Routed task to peer ${peer.name}: ${url} -> ${payload.taskId}`);
      return { ok: true, taskId: payload.taskId, status: typeof payload.status === "string" ? payload.status : "unknown" };
    } catch (err) {
      return { ok: false, error: asMessage(err) };
    }
  }

  /**
   * Probe every registered peer (the interval sweep). Never throws.
   * Probes run in bounded-concurrency batches; a failing persist (e.g. a
   * racing remove — Prisma P2025) is isolated per peer so one bad write
   * can't leave the rest of the fleet unprobed for a full interval.
   */
  async probeAll(): Promise<MeshSweepResult> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return { probed: 0, up: 0, down: 0, ran: false };
    }
    if (this.probing) return { probed: 0, up: 0, down: 0, ran: false };
    this.probing = true;
    try {
      const rows = await db.meshPeer.findMany();
      let up = 0;
      for (let i = 0; i < rows.length; i += PROBE_BATCH_SIZE) {
        const batch = rows.slice(i, i + PROBE_BATCH_SIZE);
        const outcomes = await Promise.all(batch.map((row) => this.checkHealth(row.baseUrl)));
        for (let j = 0; j < batch.length; j += 1) {
          const row = batch[j];
          const outcome = outcomes[j];
          if (!row || !outcome) continue;
          if (outcome.ok) up += 1;
          try {
            await db.meshPeer.update({
              where: { id: row.id },
              data: applyProbeOutcome(row, outcome, this.now),
            });
          } catch (err) {
            this.logger.warn(`Mesh sweep persist failed for ${row.id}: ${asMessage(err)}`);
          }
        }
      }
      return { probed: rows.length, up, down: rows.length - up, ran: true };
    } catch (err) {
      this.logger.warn(`Mesh sweep failed: ${asMessage(err)}`);
      return { probed: 0, up: 0, down: 0, ran: false };
    } finally {
      this.probing = false;
    }
  }

  /** Remove a peer. True when a row was actually deleted. */
  async remove(id: string): Promise<boolean> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return false;
    }
    try {
      const res = await db.meshPeer.deleteMany({ where: { id } });
      return res.count > 0;
    } catch (err) {
      this.logger.warn(`Mesh peer remove failed: ${asMessage(err)}`);
      return false;
    }
  }

  /** Fetch the peer's current row as a view (null when missing). */
  private async view(id: string): Promise<MeshPeerView | null> {
    const db = this.prisma.db;
    if (!db) return null;
    const row = await db.meshPeer.findUnique({ where: { id } });
    return row ? toView(row) : null;
  }

  /**
   * The actual health probe: GET <baseUrl>/api/health with a bounded timeout.
   * ANY 2xx counts as `up` — the peer's own health body may say `ok` or
   * `degraded`, but a reachable instance is reachable. Network errors,
   * timeouts, and non-2xx all resolve to `down` with the reason.
   */
  private async checkHealth(baseUrl: string): Promise<{ ok: boolean; error: string | null }> {
    const url = `${baseUrl}/api/health`;
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        signal: AbortSignal.timeout(this.probeTimeoutMs),
      });
      // We only read the status code — cancel the body so undici can reuse
      // the keep-alive socket instead of holding the buffer until GC (worst
      // when many peers are DOWN with 4xx/5xx bodies).
      await res.body?.cancel();
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Prefer the error NAME (TimeoutError/AbortError from AbortSignal /
      // undici); the substring sniff is kept as a fallback for node versions
      // whose timeout error is a plain Error with "aborted"/"timeout" text.
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError" || msg.includes("timeout") || msg.includes("aborted")) {
        return { ok: false, error: `timeout after ${this.probeTimeoutMs}ms` };
      }
      // undici nests the real reason (ECONNREFUSED...) two levels deep:
      // TypeError "fetch failed" -> cause -> cause. Walk the chain.
      const detail = deepestCauseMessage(err);
      return { ok: false, error: detail ?? msg };
    }
  }

  private warnNoDbOnce(): void {
    if (this.warnedNoDb) return;
    this.warnedNoDb = true;
    this.logger.warn("Mesh service degraded: no database configured");
  }
}

/** The probe-outcome persist block shared by `probe` and the `probeAll` sweep. */
function applyProbeOutcome(
  row: { lastSeen: Date | null },
  outcome: { ok: boolean; error: string | null },
  now: () => Date,
): { status: string; lastSeen: Date | null; lastError: string | null; lastProbedAt: Date } {
  return {
    status: outcome.ok ? PEER_STATUS.UP : PEER_STATUS.DOWN,
    // lastSeen only advances on success — a stale "last seen" is honest.
    lastSeen: outcome.ok ? now() : row.lastSeen,
    lastError: outcome.error,
    lastProbedAt: now(),
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Walk an error's cause/errors chain to its deepest message. Real undici
 *  shape: TypeError "fetch failed" → AggregateError("") → errors[] containing
 *  the actual reason (e.g. "connect ECONNREFUSED …"). */
function deepestCauseMessage(err: unknown, depth = 0): string | null {
  if (depth > 5) return null;
  const e = err as { message?: unknown; cause?: unknown; errors?: unknown[] } | null;
  if (!e) return null;
  let deepest: string | null = null;
  if (typeof e.message === "string" && e.message) deepest = e.message;
  if (Array.isArray(e.errors)) {
    for (const sub of e.errors) {
      const subMsg = deepestCauseMessage(sub, depth + 1);
      if (subMsg) deepest = subMsg;
    }
    return deepest;
  }
  const subMsg = deepestCauseMessage(e.cause, depth + 1);
  return subMsg ?? deepest;
}

function toView(row: {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyHash: string | null;
  status: string;
  lastSeen: Date | null;
  lastError: string | null;
  lastProbedAt: Date | null;
}): MeshPeerView {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    apiKeyHash: row.apiKeyHash,
    status: (row.status === PEER_STATUS.UP || row.status === PEER_STATUS.DOWN ? row.status : PEER_STATUS.UNKNOWN) as MeshPeerStatus,
    lastSeen: row.lastSeen?.toISOString() ?? null,
    lastError: row.lastError,
    lastProbedAt: row.lastProbedAt?.toISOString() ?? null,
  };
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
