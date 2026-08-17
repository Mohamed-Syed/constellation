import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../database/prisma.service.js";
import { TaskService } from "./task.service.js";

/**
 * Engine v0.5 additions to TaskService — dead-letter view, failed count,
 * supervisor queries. Kept in a SEPARATE file (task.service.v05.test.ts) so
 * the pre-existing task.service.test.ts suite stays provably untouched (the
 * established pattern). Hand-wired with `new`; the Prisma `db` delegate is a
 * plain object of `vi.fn()`s.
 *
 * Contracts under test:
 *  1. markFailed optionally records a failureClassification.
 *  2. findAllFailed returns failed tasks newest-first capped at limit.
 *  3. getFailedCount counts failed task rows (durable DLQ count).
 *  4. findStaleRunning returns stale running tasks.
 *  5. markResumed / markStallRetried set the supervisor resume-once state.
 *  6. No-DB degradation on every method.
 */

interface DbMock {
  agentTask: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
}

function makeDb(): DbMock {
  return {
    agentTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  };
}

function serviceWith(db: unknown): { svc: TaskService; db: DbMock } {
  const dbMock = (db ?? makeDb()) as DbMock;
  const svc = new TaskService({ db } as unknown as PrismaService);
  return { svc, db: dbMock };
}

function deferred() {
  vi.restoreAllMocks();
}

describe("TaskService (v0.5) — markFailed with classification", () => {
  afterEach(deferred);

  it("records a failureClassification when provided", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.update.mockResolvedValue({});
    await svc.markFailed("t1", "boom", "transient_exhausted");
    expect(db.agentTask.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: {
        status: "failed",
        error: "boom",
        failureClassification: "transient_exhausted",
        completedAt: expect.any(Date),
      },
    });
  });

  it("omits the classification when not provided (backward compatible)", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.update.mockResolvedValue({});
    await svc.markFailed("t1", "boom");
    const data = db.agentTask.update.mock.calls[0]![0]!.data;
    expect(data.status).toBe("failed");
    expect(data.error).toBe("boom");
    expect(data.failureClassification).toBeUndefined();
  });

  it("no-op without a db", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.markFailed("t1", "boom", "stalled")).resolves.toBeUndefined();
  });
});

describe("TaskService (v0.5) — dead-letter view", () => {
  afterEach(deferred);

  it("findAllFailed queries failed tasks newest-first capped at the default 100", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "x",
        status: "failed",
        failureClassification: "terminal",
        error: "boom",
      },
    ]);
    await svc.findAllFailed();
    const arg = db.agentTask.findMany.mock.calls[0]![0];
    expect(arg.where).toEqual({ status: "failed" });
    expect(arg.orderBy).toEqual({ updatedAt: "desc" });
    expect(arg.take).toBe(100);
    expect(arg.select.failureClassification).toBe(true);
  });

  it("findAllFailed honours a custom limit", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.findMany.mockResolvedValue([]);
    await svc.findAllFailed(25);
    expect(db.agentTask.findMany.mock.calls[0]![0].take).toBe(25);
  });

  it("findAllFailed returns [] without a db", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.findAllFailed()).resolves.toEqual([]);
  });

  it("getFailedCount counts failed task rows", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.count.mockResolvedValue(7);
    await expect(svc.getFailedCount()).resolves.toBe(7);
    expect(db.agentTask.count).toHaveBeenCalledWith({ where: { status: "failed" } });
  });

  it("getFailedCount returns 0 without a db", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.getFailedCount()).resolves.toBe(0);
  });
});

describe("TaskService (v0.5) — supervisor queries", () => {
  afterEach(deferred);

  it("findStaleRunning returns running tasks older than the threshold (oldest first)", async () => {
    const { svc, db } = serviceWith(makeDb());
    const staleBefore = new Date("2026-08-03T11:55:00.000Z");
    db.agentTask.findMany.mockResolvedValue([{ id: "t1", status: "running" }]);
    await svc.findStaleRunning(staleBefore);
    const arg = db.agentTask.findMany.mock.calls[0]![0];
    expect(arg.where).toEqual({ status: "running", updatedAt: { lt: staleBefore } });
    expect(arg.orderBy).toEqual({ updatedAt: "asc" });
    expect(arg.select.stallRetried).toBe(true);
  });

  it("findStaleRunning returns [] without a db", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.findStaleRunning(new Date())).resolves.toEqual([]);
  });

  it("markResumed sets status queued and returns true; false without a db", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.update.mockResolvedValue({});
    await expect(svc.markResumed("t1")).resolves.toBe(true);
    expect(db.agentTask.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { status: "queued" } });

    const { svc: noDb } = serviceWith(undefined);
    await expect(noDb.markResumed("t1")).resolves.toBe(false);
  });

  it("markStallRetried sets the resume-once flag; false without a db", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.update.mockResolvedValue({});
    await expect(svc.markStallRetried("t1")).resolves.toBe(true);
    expect(db.agentTask.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { stallRetried: true } });

    const { svc: noDb } = serviceWith(undefined);
    await expect(noDb.markStallRetried("t1")).resolves.toBe(false);
  });

  it("markUsage persists cumulative usage; no-op without a db", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.update.mockResolvedValue({});
    await expect(
      svc.markUsage("t1", { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUSD: 0.001 }),
    ).resolves.toBeUndefined();
    expect(db.agentTask.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUSD: 0.001 },
    });

    const { svc: noDb } = serviceWith(undefined);
    await expect(noDb.markUsage("t1", { totalTokens: 1 })).resolves.toBeUndefined();
  });
});
