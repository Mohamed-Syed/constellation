import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { PrismaService } from "../database/prisma.service.js";
import {
  __setFetchForTests,
  MeshService,
  type FetchLike,
  type HttpRequestInitLike,
} from "./mesh.service.js";

/** Minimal prisma delegate: every meshPeer method a vi.fn. */
function fakeDb(overrides: Record<string, unknown> = {}) {
  const db = {
    meshPeer: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    ...overrides,
  };
  return { db } as unknown as PrismaService;
}

const okFetch: FetchLike = async () => ({ ok: true, status: 200 });
const failingFetch: FetchLike = async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:4999");
};
const http503Fetch: FetchLike = async () => ({ ok: false, status: 503 });
/** Rejects only when the caller's abort signal fires — the real-timer abort test. */
const abortFetch: FetchLike = (_url: string, init?: HttpRequestInitLike) =>
  new Promise<never>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("This operation was aborted")));
  });

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "peer_1",
    name: "dev",
    baseUrl: "http://localhost:4002",
    apiKeyHash: null,
    status: "unknown",
    lastSeen: null,
    lastError: null,
    lastProbedAt: null,
    createdAt: new Date("2026-08-05T00:00:00.000Z"),
    updatedAt: new Date("2026-08-05T00:00:00.000Z"),
    ...overrides,
  };
}

const fixedNow = () => new Date("2026-08-05T12:00:00.000Z");

function makeService(db: PrismaService, fetchImpl: FetchLike = okFetch, options?: { probeTimeoutMs?: number }) {
  const svc = new MeshService(
    db,
    { get: vi.fn(() => undefined) } as never,
    { now: fixedNow, ...options } as never,
  );
  __setFetchForTests(fetchImpl);
  return svc;
}

/** makeService but with a custom ConfigService (e.g. one that returns a route key). */
function createWithEnv(db: PrismaService, config: unknown, fetchImpl: FetchLike = okFetch) {
  const svc = new MeshService(db, config as never, { now: fixedNow } as never);
  __setFetchForTests(fetchImpl);
  return svc;
}

describe("MeshService — federated agent mesh (4.6)", () => {
  beforeEach(() => {
    __setFetchForTests(okFetch);
  });

  afterEach(() => {
    __setFetchForTests(undefined);
    vi.restoreAllMocks();
  });

  it("degrades cleanly with no database — register no-db, topology empty, probe null, remove false", async () => {
    const svc = makeService({ db: undefined } as unknown as PrismaService);
    expect(await svc.register({ name: "x", baseUrl: "http://localhost:4002" })).toEqual({
      ok: false,
      error: "no-db",
    });
    expect(await svc.topology()).toEqual({
      peers: [],
      counts: { total: 0, up: 0, down: 0, unknown: 0 },
      probeIntervalMs: 60_000,
    });
    expect(await svc.probe("peer_1")).toBeNull();
    expect(await svc.probeAll()).toEqual({ probed: 0, up: 0, down: 0, ran: false });
    expect(await svc.remove("peer_1")).toBe(false);
  });

  it("registers a peer: trims name, strips trailing slash, hashes the API key (never stores it raw), probes immediately", async () => {
    const db = fakeDb();
    const created = row({ id: "peer_9", name: "dev", baseUrl: "http://localhost:4002", apiKeyHash: "hash" });
    (db.db.meshPeer as any).create.mockResolvedValue(created);
    (db.db.meshPeer as any).findUnique.mockResolvedValue({ ...created, status: "up", lastSeen: fixedNow() });
    (db.db.meshPeer as any).update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...created,
      ...args.data,
    }));
    const svc = makeService(db, okFetch);

    const result = await svc.register({ name: "  dev  ", baseUrl: "http://localhost:4002/", apiKey: "s3cret-key" });

    expect(result).toMatchObject({ ok: true });
    expect((db.db.meshPeer as any).create).toHaveBeenCalledWith({
      data: {
        name: "dev",
        baseUrl: "http://localhost:4002",
        apiKeyHash: createHash("sha256").update("s3cret-key").digest("hex"),
        status: "unknown",
      },
    });
    // The raw key must never reach the DB layer.
    expect(JSON.stringify((db.db.meshPeer as any).create.mock.calls[0])).not.toContain("s3cret-key");
    // Immediate probe: update called with up + lastSeen.
    expect((db.db.meshPeer as any).update).toHaveBeenCalled();
    const updateCall = (db.db.meshPeer as any).update.mock.calls[0][0].data;
    expect(updateCall.status).toBe("up");
    expect(updateCall.lastSeen).toEqual(fixedNow());
    // The probe's own update returns the fresh view — no redundant re-read.
    expect((db.db.meshPeer as any).findUnique).toHaveBeenCalledTimes(1);
    expect(result.ok && result.peer.status).toBe("up");
  });

  it("rejects a duplicate name with a precise 'duplicate' reason (Prisma P2002)", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).create.mockRejectedValue(Object.assign(new Error("unique violation"), { code: "P2002" }));
    const svc = makeService(db, okFetch);

    const result = await svc.register({ name: "dev", baseUrl: "http://localhost:4002" });

    expect(result).toEqual({ ok: false, error: "duplicate" });
  });

  it("rejects empty name/baseUrl as 'invalid' without touching the DB", async () => {
    const db = fakeDb();
    const svc = makeService(db, okFetch);

    expect(await svc.register({ name: "  ", baseUrl: "http://localhost:4002" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await svc.register({ name: "dev", baseUrl: "   " })).toEqual({ ok: false, error: "invalid" });
    expect((db.db.meshPeer as any).create).not.toHaveBeenCalled();
  });

  it("stores no apiKeyHash when no key is given", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).create.mockResolvedValue(row({ apiKeyHash: null }));
    (db.db.meshPeer as any).findUnique.mockResolvedValue(row());
    (db.db.meshPeer as any).update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...row(),
      ...args.data,
    }));
    const svc = makeService(db, okFetch);
    await svc.register({ name: "dev", baseUrl: "http://localhost:4002" });
    expect((db.db.meshPeer as any).create).toHaveBeenCalledWith({
      data: { name: "dev", baseUrl: "http://localhost:4002", apiKeyHash: null, status: "unknown" },
    });
  });

  it("probe marks a peer up (2xx) with lastSeen + lastProbedAt, even when the body is degraded", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).findUnique.mockResolvedValue(row());
    (db.db.meshPeer as any).update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...row(),
      ...args.data,
    }));
    const svc = makeService(db, okFetch);

    const peer = await svc.probe("peer_1");

    expect(peer?.status).toBe("up");
    expect((db.db.meshPeer as any).update).toHaveBeenCalledWith({
      where: { id: "peer_1" },
      data: { status: "up", lastSeen: fixedNow(), lastError: null, lastProbedAt: fixedNow() },
    });
  });

  it("probe marks a peer down with the reason when the fetch throws (ECONNREFUSED)", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).findUnique.mockResolvedValue(row());
    (db.db.meshPeer as any).update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...row(),
      ...args.data,
    }));
    const svc = makeService(db, failingFetch);

    const peer = await svc.probe("peer_1");

    expect(peer?.status).toBe("down");
    const data = (db.db.meshPeer as any).update.mock.calls[0][0].data;
    expect(data.lastError).toContain("ECONNREFUSED");
    expect(data.lastSeen).toBeNull();
  });

  it("probe marks a peer down on a non-2xx health response (HTTP 503)", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).findUnique.mockResolvedValue(row());
    (db.db.meshPeer as any).update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...row(),
      ...args.data,
    }));
    const svc = makeService(db, http503Fetch);

    const peer = await svc.probe("peer_1");

    expect(peer?.status).toBe("down");
    expect((db.db.meshPeer as any).update.mock.calls[0][0].data.lastError).toBe("HTTP 503");
  });

  it("probe times out honestly (abort signal) instead of hanging", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).findUnique.mockResolvedValue(row());
    (db.db.meshPeer as any).update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...row(),
      ...args.data,
    }));
    const svc = makeService(db, abortFetch, { probeTimeoutMs: 10 });

    const peer = await svc.probe("peer_1");

    expect(peer?.status).toBe("down");
    expect((db.db.meshPeer as any).update.mock.calls[0][0].data.lastError).toBe("timeout after 10ms");
  });

  it("probe surfaces the REAL reason from undici's AggregateError shape", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).findUnique.mockResolvedValue(row());
    (db.db.meshPeer as any).update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...row(),
      ...args.data,
    }));
    // The actual Node/undici shape for a refused connection:
    // TypeError "fetch failed" -> AggregateError("") -> errors[] [Error(ECONNREFUSED)].
    const nestedFetch: FetchLike = async () => {
      const aggregate = Object.assign(new AggregateError([new Error("connect ECONNREFUSED 127.0.0.1:4999")]), {});
      throw Object.assign(new TypeError("fetch failed"), { cause: aggregate });
    };
    const svc = makeService(db, nestedFetch);

    const peer = await svc.probe("peer_1");

    expect(peer?.status).toBe("down");
    expect((db.db.meshPeer as any).update.mock.calls[0][0].data.lastError).toBe(
      "connect ECONNREFUSED 127.0.0.1:4999",
    );
  });

  it("probe returns null for an unknown peer id", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).findUnique.mockResolvedValue(null);
    const svc = makeService(db);
    expect(await svc.probe("nope")).toBeNull();
  });

  it("topology reports per-status counts", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).findMany.mockResolvedValue([
      row({ id: "a", name: "a", status: "up" }),
      row({ id: "b", name: "b", status: "up" }),
      row({ id: "c", name: "c", status: "down" }),
      row({ id: "d", name: "d", status: "unknown" }),
    ]);
    const svc = makeService(db);

    const top = await svc.topology();

    expect(top.counts).toEqual({ total: 4, up: 2, down: 1, unknown: 1 });
    expect(top.peers.map((p) => p.name)).toEqual(["a", "b", "c", "d"]);
  });

  it("probeAll sweeps every peer and returns honest sweep counts", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).findMany.mockResolvedValue([
      row({ id: "a", baseUrl: "http://localhost:4002" }),
      row({ id: "b", baseUrl: "http://localhost:4999" }),
    ]);
    (db.db.meshPeer as any).update.mockResolvedValue(row());
    const svc = makeService(db, async (url: string) => {
      if (url.includes("4999")) throw new Error("connect ECONNREFUSED");
      return { ok: true, status: 200 };
    });

    const sweep = await svc.probeAll();

    expect(sweep).toEqual({ probed: 2, up: 1, down: 1, ran: true });
    expect((db.db.meshPeer as any).update).toHaveBeenCalledTimes(2);
    const first = (db.db.meshPeer as any).update.mock.calls[0][0].data;
    expect(first.status).toBe("up");
    const second = (db.db.meshPeer as any).update.mock.calls[1][0].data;
    expect(second.status).toBe("down");
  });

  it("probeAll isolates a failing persist (racing remove → P2025) and still reports the sweep", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).findMany.mockResolvedValue([
      row({ id: "a", baseUrl: "http://localhost:4002" }),
      row({ id: "b", baseUrl: "http://localhost:4002" }),
    ]);
    // Peer "a" was removed mid-sweep: its persist throws P2025; "b" persists fine.
    (db.db.meshPeer as any).update.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === "a") throw Object.assign(new Error("Record not found"), { code: "P2025" });
      return row();
    });
    const svc = makeService(db, okFetch);

    const sweep = await svc.probeAll();

    // The sweep counts BOTH probe outcomes (2 up) and neither peer was lost:
    expect(sweep).toEqual({ probed: 2, up: 2, down: 0, ran: true });
    expect((db.db.meshPeer as any).update).toHaveBeenCalledTimes(2);
    // The failing persist was isolated — no exception escaped to the caller.
  });

  it("probeAll probes in bounded-concurrency batches (8) without overlap", async () => {
    const db = fakeDb();
    const rows = Array.from({ length: 10 }, (_, i) => row({ id: `p${i}`, baseUrl: "http://localhost:4002" }));
    (db.db.meshPeer as any).findMany.mockResolvedValue(rows);
    (db.db.meshPeer as any).update.mockResolvedValue(row());
    let inFlight = 0;
    let maxInFlight = 0;
    const svc = makeService(db, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      return { ok: true, status: 200 };
    });

    const sweep = await svc.probeAll();

    expect(sweep).toEqual({ probed: 10, up: 10, down: 0, ran: true });
    // Two batches of 8 → max concurrency is the batch size, not the fleet size.
    expect(maxInFlight).toBeLessThanOrEqual(8);
    expect((db.db.meshPeer as any).update).toHaveBeenCalledTimes(10);
  });

  it("remove returns true only when a row was deleted", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).deleteMany.mockResolvedValue({ count: 1 });
    const svc = makeService(db);
    expect(await svc.remove("peer_1")).toBe(true);
    expect((db.db.meshPeer as any).deleteMany).toHaveBeenCalledWith({ where: { id: "peer_1" } });

    (db.db.meshPeer as any).deleteMany.mockResolvedValue({ count: 0 });
    expect(await svc.remove("peer_1")).toBe(false);
  });

  it("start()/stop() own the interval lifecycle (no timer leaks in tests)", async () => {
    const db = fakeDb();
    (db.db.meshPeer as any).findMany.mockResolvedValue([]);
    const svc = makeService(db);
    svc.start();
    expect(svc.probeInterval).toBe(60_000);
    svc.stop();
    // A second stop is a no-op — no crash.
    svc.stop();
  });

  describe("cross-instance task routing (Phase 4.0 backlog #6)", () => {
    it("returns a discriminated no-route-key error when MESH_ROUTE_API_KEY is unset", async () => {
      const db = fakeDb();
      (db.db.meshPeer as any).findUnique.mockResolvedValue(row());
      // config.get returns undefined (no key) — same as the default makeService.
      const svc = makeService(db);
      const result = await svc.routeTask("peer_1", { title: "t", prompt: "p" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("MESH_ROUTE_API_KEY");
    });

    it("forwards the task to the peer's mesh/forward receiver when the key is set", async () => {
      const db = fakeDb();
      (db.db.meshPeer as any).findUnique.mockResolvedValue(row());
      // config.get returns the shared route key.
      const env = { get: vi.fn((k: string) => (k === "MESH_ROUTE_API_KEY" ? "s3cret" : undefined)) } as never;
      const routeFetch: FetchLike = async (url, init) => {
        expect(url).toBe("http://localhost:4002/api/engine/mesh/forward");
        expect((init?.headers as Record<string, string>)?.["x-mesh-route-key"]).toBe("s3cret");
        return { ok: true, status: 200, json: async () => ({ taskId: "remote-9", status: "queued" }) };
      };
      __setFetchForTests(routeFetch);
      const svc = createWithEnv(db, env, routeFetch);
      const result = await svc.routeTask("peer_1", { title: "t", prompt: "p", model: "deepseek-v4-flash" });
      expect(result).toEqual({ ok: true, taskId: "remote-9", status: "queued" });
    });

    it("reports peer-not-found and a failing forward honestly", async () => {
      const db = fakeDb();
      (db.db.meshPeer as any).findUnique.mockResolvedValue(null);
      const env = { get: vi.fn((k: string) => (k === "MESH_ROUTE_API_KEY" ? "s3cret" : undefined)) } as never;
      const svc = createWithEnv(db, env);
      expect(await svc.routeTask("nope", { title: "t", prompt: "p" })).toEqual({ ok: false, error: "peer-not-found" });

      (db.db.meshPeer as any).findUnique.mockResolvedValue(row());
      const route403: FetchLike = async () => ({ ok: false, status: 403 });
      __setFetchForTests(route403);
      const svc2 = createWithEnv(db, env, route403);
      expect(await svc2.routeTask("peer_1", { title: "t", prompt: "p" })).toEqual({ ok: false, error: "HTTP 403" });
    });
  });
});
