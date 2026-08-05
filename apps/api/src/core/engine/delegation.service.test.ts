import { describe, expect, it, vi } from "vitest";
import { DelegationService } from "./delegation.service.js";
import type { TaskService } from "./task.service.js";
import type { TaskQueueService } from "./task-queue.service.js";

function row(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `task-${id}`,
    status: "queued",
    provider: null,
    model: null,
    actorId: "user-1",
    stepCount: 0,
    totalTokens: null,
    costUSD: null,
    parentTaskId: null,
    teamId: null,
    createdAt: new Date("2026-08-05T00:00:00Z"),
    completedAt: null,
    ...overrides,
  };
}

function makeDb(overrides: Record<string, unknown> = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const parentTaskId = overrides.parentTaskId as string | undefined;
  return {
    rows,
    agentTask: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
      findMany: vi.fn(async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: { createdAt?: string } }) => {
        if (where?.parentTaskId !== undefined) {
          const matched = Array.from(rows.values()).filter((r) => r.parentTaskId === where.parentTaskId);
          if (orderBy?.createdAt === "desc") matched.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
          else matched.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
          return matched;
        }
        return [];
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rows.get(where.id);
        if (r) Object.assign(r, data);
        return r;
      }),
    },
    parentTaskId,
  };
}

function makeSvc(prisma: unknown, created: Record<string, unknown>[] = []) {
  const tasks = {
    create: vi.fn(async (dto: Record<string, unknown>, actorId?: string) => {
      const id = `child-${created.length + 1}`;
      const r = row(id, { ...dto, actorId: actorId ?? "user-1" });
      created.push(r);
      return r;
    }),
  } as unknown as TaskService;
  const queue = { enqueue: vi.fn(async () => undefined) } as unknown as TaskQueueService;
  return { svc: new DelegationService(prisma as never, tasks, queue), tasks, queue };
}

describe("DelegationService — crews round (4.1)", () => {
  it("spawnChild creates a child linked to the parent, then enqueues it", async () => {
    const db = makeDb();
    db.rows.set("p1", row("p1", { status: "running", actorId: "boss" }));
    const { svc, tasks, queue } = makeSvc({ db });
    const child = await svc.spawnChild("p1", { title: "sub", prompt: "work" });
    expect(child).not.toBeNull();
    expect(tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "sub", prompt: "work", teamId: undefined }),
      "boss",
    );
    expect(db.agentTask.update).toHaveBeenCalledWith({ where: { id: "child-1" }, data: { parentTaskId: "p1" } });
    expect(queue.enqueue).toHaveBeenCalledWith("child-1");
  });

  it("spawnChild works under a terminal (completed) parent — the crew can grow after the orchestrator finishes", async () => {
    const db = makeDb();
    db.rows.set("p1", row("p1", { status: "completed" }));
    const { svc } = makeSvc({ db });
    const child = await svc.spawnChild("p1", { title: "sub", prompt: "x" });
    expect(child).not.toBeNull();
    expect(db.agentTask.update).toHaveBeenCalledWith({ where: { id: "child-1" }, data: { parentTaskId: "p1" } });
  });

  it("spawnChild degrades to null without a DB", async () => {
    const { svc } = makeSvc({ db: null } as never);
    expect(await svc.spawnChild("p1", { title: "s", prompt: "x" })).toBeNull();
    expect(await svc.childrenOf("p1")).toEqual([]);
  });

  it("childrenOf lists direct children newest-first", async () => {
    const db = makeDb();
    db.rows.set("p1", row("p1", { parentTaskId: null }));
    db.rows.set("c1", row("c1", { parentTaskId: "p1", createdAt: new Date("2026-08-05T01:00:00Z") }));
    db.rows.set("c2", row("c2", { parentTaskId: "p1", createdAt: new Date("2026-08-05T02:00:00Z") }));
    const { svc } = makeSvc({ db });
    const kids = await svc.childrenOf("p1");
    expect(kids.map((k) => k.id)).toEqual(["c2", "c1"]);
    expect(kids[0]?.parentTaskId).toBe("p1");
  });

  it("tree builds a nested delegation tree with the parent at the root", async () => {
    const db = makeDb();
    db.rows.set("p1", row("p1", { status: "running" }));
    db.rows.set("c1", row("c1", { parentTaskId: "p1", status: "completed" }));
    db.rows.set("gc1", row("gc1", { parentTaskId: "c1", status: "queued" }));
    const { svc } = makeSvc({ db });
    const tree = await svc.tree("p1");
    expect(tree.id).toBe("p1");
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.id).toBe("c1");
    expect(tree.children[0]?.children[0]?.id).toBe("gc1");
  });

  it("tree caps depth at TREE_MAX_DEPTH", async () => {
    const db = makeDb();
    let prev = "n0";
    db.rows.set(prev, row(prev));
    for (let i = 1; i <= 8; i += 1) {
      const id = `n${i}`;
      db.rows.set(id, row(id, { parentTaskId: prev }));
      prev = id;
    }
    const { svc } = makeSvc({ db });
    const tree = await svc.tree("n0");
    let depth = 0;
    let node = tree;
    while (node.children.length > 0) {
      node = node.children[0] as never;
      depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(4);
  });

  it("waitForChildren resolves immediately when all children are terminal", async () => {
    const db = makeDb();
    db.rows.set("p1", row("p1", { status: "running" }));
    db.rows.set("c1", row("c1", { parentTaskId: "p1", status: "completed" }));
    db.rows.set("c2", row("c2", { parentTaskId: "p1", status: "failed" }));
    const { svc } = makeSvc({ db });
    const result = await svc.waitForChildren("p1", { timeoutMs: 5_000, pollMs: 50 });
    expect(result.ok).toBe(true);
    expect(result.pending).toBe(0);
    expect(result.done).toBe(2);
  });

  it("isTerminal classifies correctly", () => {
    const { svc } = makeSvc({ db: makeDb() });
    expect(svc.isTerminal("completed")).toBe(true);
    expect(svc.isTerminal("failed")).toBe(true);
    expect(svc.isTerminal("cancelled")).toBe(true);
    expect(svc.isTerminal("running")).toBe(false);
  });
});

describe("DelegationService — crews follow-up (budget flow-down + result merging)", () => {
  it("tree aggregates descendant usage onto the root (budget flow-down)", async () => {
    const db = makeDb();
    db.rows.set("p1", row("p1", { status: "running" }));
    db.rows.set("c1", row("c1", { parentTaskId: "p1", status: "completed", totalTokens: 100, costUSD: 0.01 }));
    db.rows.set("c2", row("c2", { parentTaskId: "p1", status: "completed", totalTokens: 50, costUSD: 0.005 }));
    const { svc } = makeSvc({ db });
    const tree = await svc.tree("p1");
    expect(tree.childCount).toBe(2);
    expect(tree.childrenTotalTokens).toBe(150);
    expect(tree.childrenCostUSD).toBeCloseTo(0.015, 5);
  });

  it("mergeResults writes the merged children payload onto the parent's result", async () => {
    const db = makeDb();
    db.rows.set("p1", row("p1", { status: "completed", result: { summary: "original" } }));
    db.rows.set("c1", row("c1", { parentTaskId: "p1", status: "completed", totalTokens: 10, result: { summary: "sub result" } }));
    const { svc } = makeSvc({ db });
    const merged = await svc.mergeResults("p1");
    expect(merged?.summary).toContain("Merged 1 sub-agent result");
    expect((merged?.children as Array<Record<string, unknown>>)[0]?.title).toBe("task-c1");
    expect(db.agentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1" }, data: expect.objectContaining({ result: expect.any(Object) }) }),
    );
  });
});
