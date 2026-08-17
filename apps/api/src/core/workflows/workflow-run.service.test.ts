import { describe, expect, it, vi } from "vitest";
import { WorkflowRunService } from "./workflow-run.service.js";

/**
 * Phase 3.0 — the workflow RUN EXECUTOR, exercised with fake seams:
 * stubbed task/queue/tool services + an injected `waitForTask` so no real
 * engine worker or queue is involved. The prisma stub records the run row
 * writes so the outcome trail is asserted.
 */
function makeService(overrides: {
  tasks?: unknown;
  queue?: unknown;
  tools?: unknown;
  waitForTask?: (taskId: string) => Promise<{ status: string; result?: unknown; error?: string | null }>;
  db?: Record<string, unknown>;
}) {
  const prisma = {
    db: overrides.db ?? {
      workflowRun: {
        create: vi.fn().mockResolvedValue({ id: "run1", status: "running" }),
        update: vi.fn().mockResolvedValue({}),
      },
    },
  };
  const workflows = { getValidated: vi.fn() };
  const tasks = overrides.tasks ?? {
    create: vi.fn().mockResolvedValue({ id: "task1" }),
    findOne: vi.fn(),
  };
  const queue = overrides.queue ?? { enqueue: vi.fn().mockResolvedValue(undefined) };
  const tools = overrides.tools ?? {
    invoke: vi.fn().mockResolvedValue({ outcome: "completed", result: { ok: true, data: { nodes: 3 } }, durationMs: 5 }),
  };
  const svc = new WorkflowRunService(prisma as never, workflows as never, tasks as never, queue as never, tools as never);
  if (overrides.waitForTask) svc.waitForTask = overrides.waitForTask;
  return { svc, prisma, workflows, tasks, queue, tools };
}

const def = (steps: unknown[]) => ({ trigger: { type: "manual" }, steps }) as never;

describe("WorkflowRunService.executeRun", () => {
  it("runs agent + tool steps sequentially and completes the run", async () => {
    const { svc, prisma, tasks, queue, tools } = makeService({
      waitForTask: vi.fn().mockResolvedValue({ status: "completed", result: "first output" }),
    });
    await svc.executeRun(
      "run1",
      "Demo",
      def([
        { id: "s1", kind: "agent", label: "First", prompt: "Do it" },
        { id: "s2", kind: "tool", label: "Query", plugin: "graphify", tool: "graph.query", args: { question: "{{steps.s1.result}}" } },
      ]),
    );

    expect(tasks.create).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith("task1");
    expect(tools.invoke).toHaveBeenCalledWith("graphify", "graph.query", { question: "first output" }, ["platform:admin"]);

    const update = prisma.db.workflowRun.update as ReturnType<typeof vi.fn>;
    const final = update.mock.calls[update.mock.calls.length - 1]?.[0]?.data as {
      status: string;
      stepsResult: Array<{ id: string; ok: boolean }>;
    };
    expect(final.status).toBe("completed");
    expect(final.stepsResult).toHaveLength(2);
    expect(final.stepsResult[0]).toMatchObject({ id: "s1", ok: true });
    expect(final.stepsResult[1]).toMatchObject({ id: "s2", ok: true });
  });

  it("captures a tool step's payload whether the plugin uses result or data", async () => {
    const { svc, prisma, tools } = makeService({
      tools: {
        invoke: vi.fn().mockResolvedValue({ outcome: "completed", result: { ok: true, data: { nodes: 7 } }, durationMs: 5 }),
      },
    });
    await svc.executeRun("run1", "DataKey", def([
      { id: "s1", kind: "tool", label: "Q", plugin: "graphify", tool: "graph.query" },
    ]));

    const update = prisma.db.workflowRun.update as ReturnType<typeof vi.fn>;
    const final = update.mock.calls[update.mock.calls.length - 1]?.[0]?.data as {
      status: string;
      stepsResult: Array<{ ok: boolean; result?: unknown }>;
    };
    expect(final.status).toBe("completed");
    expect(final.stepsResult[0]?.result).toEqual({ nodes: 7 });
    expect(tools.invoke).toHaveBeenCalledTimes(1);
  });

  it("stops at the first failing step and marks the run failed with the trail", async () => {
    const { svc, prisma, tasks, queue, tools } = makeService({
      waitForTask: vi.fn().mockResolvedValue({ status: "failed", error: "model blew up" }),
    });
    await svc.executeRun("run1", "Bad", def([
      { id: "s1", kind: "agent", label: "First", prompt: "Do it" },
      { id: "s2", kind: "tool", label: "Never", plugin: "graphify", tool: "graph.query" },
    ]));

    expect(tools.invoke).not.toHaveBeenCalled(); // never reached
    expect(tasks.create).toHaveBeenCalledTimes(1);

    const update = prisma.db.workflowRun.update as ReturnType<typeof vi.fn>;
    const final = update.mock.calls[update.mock.calls.length - 1]?.[0]?.data as {
      status: string;
      stepsResult: Array<{ id: string; ok: boolean }>;
      error: string;
    };
    expect(final.status).toBe("failed");
    expect(final.stepsResult).toHaveLength(1);
    expect(final.stepsResult[0]).toMatchObject({ id: "s1", ok: false });
    expect(final.error).toContain("s1");
  });

  it("records a tool-step rejection (real envelope: no result key) as a failed step", async () => {
    const { svc, prisma, tools } = makeService({
      tools: {
        invoke: vi.fn().mockResolvedValue({ outcome: "rejected", reason: "forbidden", message: 'Calling "graph.query" requires the "x" permission.' }),
      },
    });
    await svc.executeRun("run1", "Denied", def([
      { id: "s1", kind: "tool", label: "Q", plugin: "graphify", tool: "graph.query" },
    ]));

    const update = prisma.db.workflowRun.update as ReturnType<typeof vi.fn>;
    const final = update.mock.calls[update.mock.calls.length - 1]?.[0]?.data as {
      status: string;
      stepsResult: Array<{ ok: boolean; error?: string }>;
    };
    expect(final.status).toBe("failed");
    expect(final.stepsResult[0]?.ok).toBe(false);
    expect(final.stepsResult[0]?.error).toContain("forbidden");
  });

  it("persists the partial trail after each step (crash-safety record)", async () => {
    const { svc, prisma, tools } = makeService({
      tools: {
        invoke: vi.fn().mockResolvedValue({ outcome: "completed", result: { ok: false, error: "nope" }, durationMs: 2 }),
      },
    });
    await svc.executeRun("run1", "Partial", def([
      { id: "s1", kind: "tool", label: "A", plugin: "p", tool: "t" },
      { id: "s2", kind: "tool", label: "B", plugin: "p", tool: "t" },
    ]));

    const update = prisma.db.workflowRun.update as ReturnType<typeof vi.fn>;
    // One update after step 1 (partial trail with 1 entry) + the final update.
    expect(update.mock.calls.length).toBe(2);
    const partial = update.mock.calls[0]?.[0]?.data as { stepsResult: unknown[] };
    expect(partial.stepsResult).toHaveLength(1);
  });

  it("swallows executor throws into a failed run instead of propagating", async () => {
    const { svc, prisma, tasks } = makeService({
      tasks: { create: vi.fn().mockRejectedValue(new Error("db down")) },
      queue: { enqueue: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(svc.executeRun("run1", "Broken", def([
      { id: "s1", kind: "agent", prompt: "x" },
    ]))).resolves.toBeUndefined();

    const update = prisma.db.workflowRun.update as ReturnType<typeof vi.fn>;
    const final = update.mock.calls[update.mock.calls.length - 1]?.[0]?.data as { status: string; error: string };
    expect(final.status).toBe("failed");
    expect(final.error).toContain("db down");
  });
});
