import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../database/prisma.service.js";
import type { CreateTaskDto } from "./dto/create-task.dto.js";
import { TaskService, type TaskStepData } from "./task.service.js";

/**
 * TaskService CRUD tests. Hand-wired with `new` — no Nest DI container
 * (the established offline pattern, see `plugin-tool.test.ts`). The only
 * collaborator is PrismaService, and TaskService only ever touches
 * `this.prisma.db`, so the whole database is faked with a plain object of
 * `vi.fn()` delegates.
 *
 * The two contracts under test:
 *  1. With a db, every call forwards the exact Prisma payload the service
 *     promises (defaults included — `maxSteps: 20`, `status: "queued"`).
 *  2. With NO db, every call degrades gracefully (returns null/[]/false or
 *     resolves undefined) — except `create`, which throws the documented
 *     "Database not available" error.
 */

interface DbMock {
  agentTask: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  taskStep: { create: ReturnType<typeof vi.fn> };
  taskCheckpoint: { upsert: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

function makeDb(): DbMock {
  return {
    agentTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    taskStep: { create: vi.fn() },
    taskCheckpoint: { upsert: vi.fn(), findUnique: vi.fn() },
    // Mimic Prisma's $transaction over an array of promises.
    $transaction: vi.fn(async (ops: unknown[]) => {
      for (const op of ops) await op;
    }),
  };
}

function serviceWith(db: unknown): { svc: TaskService; db: DbMock } {
  const dbMock = (db ?? makeDb()) as DbMock;
  const svc = new TaskService({ db } as unknown as PrismaService);
  return { svc, db: dbMock };
}

const dto = (overrides: Partial<CreateTaskDto> = {}): CreateTaskDto =>
  ({ title: "Write tests", prompt: "Cover the engine module.", ...overrides }) as CreateTaskDto;

describe("TaskService — create", () => {
  it("creates a queued task with the default maxSteps of 20", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.create.mockResolvedValue({ id: "t1", status: "queued" });
    const task = await svc.create(dto(), "user-1");

    expect(db.agentTask.create).toHaveBeenCalledOnce();
    const data = db.agentTask.create.mock.calls[0]![0]!.data;
    expect(data.title).toBe("Write tests");
    expect(data.prompt).toBe("Cover the engine module.");
    expect(data.actorId).toBe("user-1");
    expect(data.status).toBe("queued");
    expect(data.maxSteps).toBe(20);
    expect(data.model).toBeUndefined();
    expect(task).toEqual({ id: "t1", status: "queued" });
  });

  it("honours an explicit model and maxSteps", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.create.mockResolvedValue({ id: "t1" });
    await svc.create(dto({ model: "llama3.2", maxSteps: 5 }), "user-1");

    const data = db.agentTask.create.mock.calls[0]![0]!.data;
    expect(data.model).toBe("llama3.2");
    expect(data.maxSteps).toBe(5);
  });

  it("works without an actor (anonymous submission)", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.create.mockResolvedValue({ id: "t1" });
    await svc.create(dto());
    expect(db.agentTask.create.mock.calls[0]![0]!.data.actorId).toBeUndefined();
  });

  it("throws a documented error when there is no database", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.create(dto(), "user-1")).rejects.toThrow("Database not available");
  });
});

describe("TaskService — findAll", () => {
  it("returns [] when there is no database", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.findAll()).resolves.toEqual([]);
  });

  it("lists tasks newest-first, capped at 100, with the fixed summary projection", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);

    const rows = await svc.findAll();

    expect(rows).toEqual([{ id: "t1" }, { id: "t2" }]);
    const args = db.agentTask.findMany.mock.calls[0]![0]!;
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.take).toBe(100);
    expect(args.select).toEqual({
      id: true,
      title: true,
      status: true,
      model: true,
      provider: true,
      stepCount: true,
      maxSteps: true,
      actorId: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      completedAt: true,
      error: true,
    });
  });
});

describe("TaskService — findOne", () => {
  it("returns null when there is no database", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.findOne("t1")).resolves.toBeNull();
  });

  it("fetches a task with its steps ordered by stepIndex", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.findUnique.mockResolvedValue({ id: "t1", steps: [] });

    await svc.findOne("t1");

    expect(db.agentTask.findUnique).toHaveBeenCalledWith({
      where: { id: "t1" },
      include: { steps: { orderBy: { stepIndex: "asc" } } },
    });
  });
});

describe("TaskService — markRunning / markCompleted / markFailed", () => {
  it("markRunning does nothing (resolves) without a database", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.markRunning("t1")).resolves.toBeUndefined();
  });

  it("markRunning sets status, startedAt and provider", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.update.mockResolvedValue({ id: "t1" });

    await svc.markRunning("t1", "ollama");

    expect(db.agentTask.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "running", startedAt: expect.any(Date), provider: "ollama" },
    });
  });

  it("markRunning tolerates an absent provider", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.update.mockResolvedValue({});
    await svc.markRunning("t1");
    expect(db.agentTask.update.mock.calls[0]![0]!.data.provider).toBeUndefined();
  });

  it("markCompleted stores the result and completion time", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.update.mockResolvedValue({});

    await svc.markCompleted("t1", { summary: "done" });

    expect(db.agentTask.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "completed", result: { summary: "done" }, completedAt: expect.any(Date) },
    });
  });

  it("markFailed stores the error and completion time", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.update.mockResolvedValue({});

    await svc.markFailed("t1", "model exploded");

    expect(db.agentTask.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "failed", error: "model exploded", completedAt: expect.any(Date) },
    });
  });

  it("markCompleted and markFailed resolve silently without a database", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.markCompleted("t1", {})).resolves.toBeUndefined();
    await expect(svc.markFailed("t1", "boom")).resolves.toBeUndefined();
  });
});

describe("TaskService — cancel", () => {
  it("returns false when there is no database", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.cancel("t1")).resolves.toBe(false);
  });

  it("returns false when the task does not exist", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.findUnique.mockResolvedValue(null);

    await expect(svc.cancel("ghost")).resolves.toBe(false);
    expect(db.agentTask.update).not.toHaveBeenCalled();
  });

  it("returns false and does NOT update terminal statuses (completed / failed / cancelled)", async () => {
    for (const status of ["completed", "failed", "cancelled"]) {
      const { svc, db } = serviceWith(makeDb());
      db.agentTask.findUnique.mockResolvedValue({ status });

      await expect(svc.cancel("t1")).resolves.toBe(false);
      expect(db.agentTask.update).not.toHaveBeenCalled();
    }
  });

  it("cancels a queued task and returns true", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.agentTask.findUnique.mockResolvedValue({ status: "queued" });
    db.agentTask.update.mockResolvedValue({ id: "t1", status: "cancelled" });

    await expect(svc.cancel("t1")).resolves.toBe(true);

    expect(db.agentTask.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "cancelled", completedAt: expect.any(Date) },
    });
  });

  it("cancels running and paused tasks too", async () => {
    for (const status of ["running", "paused"]) {
      const { svc, db } = serviceWith(makeDb());
      db.agentTask.findUnique.mockResolvedValue({ status });
      db.agentTask.update.mockResolvedValue({});

      await expect(svc.cancel("t1")).resolves.toBe(true);
      expect(db.agentTask.update.mock.calls[0]![0]!.data.status).toBe("cancelled");
    }
  });
});

describe("TaskService — addStep", () => {
  it("does nothing (resolves) without a database", async () => {
    const { svc } = serviceWith(undefined);
    await expect(
      svc.addStep("t1", { stepIndex: 0, type: "thought", content: { thought: "hi" } }),
    ).resolves.toBeUndefined();
  });

  it("creates the step and increments stepCount inside one transaction", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.taskStep.create.mockResolvedValue({ id: "s1" });
    db.agentTask.update.mockResolvedValue({ id: "t1" });

    const step: TaskStepData = {
      stepIndex: 2,
      type: "tool_call",
      content: { plugin: "cap", tool: "cap.read", args: { url: "https://x" } },
    };
    await svc.addStep("t1", step);

    expect(db.taskStep.create).toHaveBeenCalledWith({
      data: { taskId: "t1", stepIndex: 2, type: "tool_call", content: step.content },
    });
    expect(db.agentTask.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { stepCount: { increment: 1 } },
    });
    // Both writes go through the same transaction, in order.
    expect(db.$transaction).toHaveBeenCalledOnce();
    const ops = db.$transaction.mock.calls[0]![0] as unknown[];
    expect(ops).toHaveLength(2);
  });
});

describe("TaskService — saveCheckpoint / loadCheckpoint", () => {
  it("saveCheckpoint does nothing (resolves) without a database", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.saveCheckpoint("t1", [], 0)).resolves.toBeUndefined();
  });

  it("saveCheckpoint upserts the checkpoint with messages and stepIndex", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.taskCheckpoint.upsert.mockResolvedValue({ taskId: "t1" });

    const messages = [{ role: "user", content: "Continue." }];
    await svc.saveCheckpoint("t1", messages, 3);

    expect(db.taskCheckpoint.upsert).toHaveBeenCalledWith({
      where: { taskId: "t1" },
      create: { taskId: "t1", messages, stepIndex: 3 },
      update: { messages, stepIndex: 3 },
    });
  });

  it("loadCheckpoint returns null without a database", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.loadCheckpoint("t1")).resolves.toBeNull();
  });

  it("loadCheckpoint returns null when no checkpoint exists", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.taskCheckpoint.findUnique.mockResolvedValue(null);
    await expect(svc.loadCheckpoint("t1")).resolves.toBeNull();
  });

  it("loadCheckpoint returns messages and stepIndex", async () => {
    const { svc, db } = serviceWith(makeDb());
    const messages = [{ role: "assistant", content: '{"type":"done"}' }];
    db.taskCheckpoint.findUnique.mockResolvedValue({ taskId: "t1", messages, stepIndex: 4 });

    const cp = await svc.loadCheckpoint("t1");

    expect(cp).toEqual({ messages, stepIndex: 4 });
    expect(db.taskCheckpoint.findUnique).toHaveBeenCalledWith({ where: { taskId: "t1" } });
  });
});

describe("TaskService — isCancelled", () => {
  it("returns false without a database", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.isCancelled("t1")).resolves.toBe(false);
  });

  it("returns true only when the status is cancelled", async () => {
    for (const [status, expected] of [
      ["cancelled", true],
      ["queued", false],
      ["running", false],
      ["completed", false],
      ["failed", false],
    ] as const) {
      const { svc, db } = serviceWith(makeDb());
      db.agentTask.findUnique.mockResolvedValue({ status });
      await expect(svc.isCancelled("t1")).resolves.toBe(expected);
    }
  });
});
