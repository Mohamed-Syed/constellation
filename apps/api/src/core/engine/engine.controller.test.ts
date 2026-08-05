import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { EngineUnavailableError } from "./engine-availability.service.js";
import { EngineController } from "./engine.controller.js";

/**
 * EngineController tests — hand-wired with `new`, no Nest DI container
 * (same offline pattern as the rest of the engine suite). Focus is the
 * Engine v0.1 contracts:
 *  - submitTask → clean 503 when the engine is disabled (never a hang), and
 *    the task is NOT created;
 *  - when the queue dies between the check and the enqueue, the task row is
 *    marked failed and the caller still gets a 503;
 *  - `/health` reports engine available/unavailable with a reason;
 *  - approve/reject only act on paused tasks, audit the decision, and
 *    approve re-enqueues while reject fails the task.
 */

function makeTasksStub() {
  return {
    create: vi.fn(async (dto: { title: string }) => ({
      id: "task-1",
      title: dto.title,
      status: "queued",
      createdAt: new Date().toISOString(),
    })),
    findAll: vi.fn(async () => []),
    findAllFailed: vi.fn(async () => []),
    getFailedCount: vi.fn(async () => 0),
    findOne: vi.fn(async () => null),
    cancel: vi.fn(async () => true),
    markFailed: vi.fn(async () => undefined),
    markPaused: vi.fn(async () => undefined),
    markQueued: vi.fn(async () => undefined),
    approvePendingApproval: vi.fn(async () => null),
  };
}

function makeQueueStub() {
  return {
    enqueue: vi.fn(async () => undefined),
    getHealth: vi.fn(async () => ({
      enabled: true,
      queue: "engine-tasks",
      waiting: 1,
      active: 0,
      failed: 0,
    })),
  };
}

function makeModelStub() {
  return {
    health: vi.fn(async () => ({ provider: "ollama", model: "qwen2.5-coder:1.5b", reachable: true })),
  };
}

function makeAvailability(enabled: boolean, reason: string | null = null) {
  return { isEnabled: enabled, reason };
}

function makeAuditStub() {
  return { record: vi.fn(async () => undefined) };
}

function makeSchedulerStub() {
  return {
    getHealth: vi.fn(async () => ({
      enabled: true,
      pollIntervalMs: 30000,
      lastSweepAt: null,
      dueCount: 0,
      registeredEvents: 0,
    })),
    refreshEventListeners: vi.fn(async () => 0),
  };
}

function makeSupervisorStub() {
  return {
    getHealth: vi.fn(async () => ({
      enabled: true,
      pollIntervalMs: 30000,
      staleThresholdMs: 300000,
      lastSweepAt: null,
      staleFound: 0,
      recovered: 0,
      failedStalled: 0,
    })),
  };
}

function makeAlertsStub() {
  return {
    getAlertSummary: vi.fn(async () => []),
  };
}

function makeController(
  availability = makeAvailability(true),
  tasks = makeTasksStub(),
  queue = makeQueueStub(),
  model = makeModelStub(),
  audit = makeAuditStub(),
  scheduler = makeSchedulerStub(),
  supervisor = makeSupervisorStub(),
  alerts = makeAlertsStub(),
  teams = { isMember: vi.fn(async () => true), listForUser: vi.fn(async () => []) },
) {
  const controller = new EngineController(
    tasks as never,
    queue as never,
    model as never,
    availability as never,
    audit as never,
    scheduler as never,
    supervisor as never,
    alerts as never,
    teams as never,
  );
  return { controller, tasks, queue, model, availability, audit, scheduler, supervisor, alerts, teams };
}

const user: AuthPrincipal = { id: "user-1", email: "a@b.c", roles: ["admin"], permissions: ["platform:admin"] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EngineController — submitTask with a disabled engine", () => {
  it("returns a clean 503 without creating a task row", async () => {
    const { controller, tasks, queue } = makeController(
      makeAvailability(false, "Redis unreachable at localhost:6380"),
    );

    await expect(
      controller.submitTask({ title: "t", prompt: "p" }, user),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(tasks.create).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});

describe("EngineController — submitTask with an enabled engine", () => {
  it("creates the task and enqueues it", async () => {
    const { controller, tasks, queue } = makeController();

    const result = await controller.submitTask({ title: "t", prompt: "p" }, user);

    expect(tasks.create).toHaveBeenCalledOnce();
    expect(queue.enqueue).toHaveBeenCalledWith("task-1");
    expect(result).toMatchObject({ id: "task-1", status: "queued", title: "t" });
  });

  it("marks the task failed and returns 503 if Redis dies between check and enqueue", async () => {
    const queue = makeQueueStub();
    queue.enqueue.mockRejectedValueOnce(new EngineUnavailableError("could not enqueue task task-1: ECONNREFUSED"));
    const { controller, tasks } = makeController(makeAvailability(true), makeTasksStub(), queue);

    await expect(
      controller.submitTask({ title: "t", prompt: "p" }, user),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(tasks.markFailed).toHaveBeenCalledWith("task-1", expect.stringContaining("Engine unavailable"));
  });
});

describe("EngineController — health", () => {
  it("reports the engine available with queue + model when enabled", async () => {
    const { controller, queue, model } = makeController();

    const health = await controller.health();

    expect(health.engine).toBe("available");
    expect(health.reason).toBeNull();
    expect(health.queue).toEqual({ enabled: true, queue: "engine-tasks", waiting: 1, active: 0, failed: 0, failedTasks: 0 });
    expect(health.model.reachable).toBe(true);
    expect(health.supervision.enabled).toBe(true);
    expect(health.alerts).toEqual([]);
    expect(queue.getHealth).toHaveBeenCalledOnce();
    expect(model.health).toHaveBeenCalledOnce();
  });

  it("reports the engine unavailable with a reason when disabled", async () => {
    const queue = makeQueueStub();
    queue.getHealth.mockResolvedValueOnce({ enabled: false, reason: "REDIS_URL is not set" });
    const { controller } = makeController(makeAvailability(false, "REDIS_URL is not set"), makeTasksStub(), queue);

    const health = await controller.health();

    expect(health.engine).toBe("unavailable");
    expect(health.reason).toContain("REDIS_URL is not set");
    // Engine v0.5: health always includes the durable failed-task count even
    // when the queue is disabled/degraded.
    expect(health.queue).toEqual({ enabled: false, reason: "REDIS_URL is not set", failedTasks: 0 });
    expect(queue.getHealth).toHaveBeenCalledOnce();
  });
});

describe("EngineController — approve", () => {
  it("approves a paused task: grants the step, re-enqueues, returns queued", async () => {
    const tasks = makeTasksStub();
    tasks.findOne.mockResolvedValueOnce({ id: "t1", status: "paused" });
    tasks.approvePendingApproval.mockResolvedValueOnce(4);
    const { controller, queue, audit } = makeController(makeAvailability(true), tasks);

    const result = await controller.approveTask("t1", user);

    expect(result).toEqual({ id: "t1", status: "queued", approvedStepIndex: 4 });
    expect(tasks.markQueued).toHaveBeenCalledWith("t1");
    expect(queue.enqueue).toHaveBeenCalledWith("t1");
    expect(audit.record).toHaveBeenCalledWith("user-1", "engine.task.approved", "t1", {
      approvedStepIndex: 4,
      actor: "a@b.c",
    });
  });

  it("rejects approving a task that is not paused", async () => {
    const tasks = makeTasksStub();
    tasks.findOne.mockResolvedValueOnce({ id: "t1", status: "running" });
    const { controller, queue } = makeController(makeAvailability(true), tasks);

    await expect(controller.approveTask("t1", user)).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("rejects approving a task with no pending tool call", async () => {
    const tasks = makeTasksStub();
    tasks.findOne.mockResolvedValueOnce({ id: "t1", status: "paused" });
    tasks.approvePendingApproval.mockResolvedValueOnce(null);
    const { controller, queue } = makeController(makeAvailability(true), tasks);

    await expect(controller.approveTask("t1", user)).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("404s when the task does not exist", async () => {
    const { controller } = makeController();
    await expect(controller.approveTask("nope", user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("restores paused and 503s when Redis dies during the approve enqueue", async () => {
    const tasks = makeTasksStub();
    tasks.findOne.mockResolvedValueOnce({ id: "t1", status: "paused" });
    tasks.approvePendingApproval.mockResolvedValueOnce(4);
    const queue = makeQueueStub();
    queue.enqueue.mockRejectedValueOnce(new EngineUnavailableError("could not enqueue task t1: ECONNREFUSED"));
    const { controller } = makeController(makeAvailability(true), tasks, queue);

    await expect(controller.approveTask("t1", user)).rejects.toBeInstanceOf(ServiceUnavailableException);
    // The approval is still pending — the task goes back to paused.
    expect(tasks.markPaused).toHaveBeenCalledWith("t1");
    expect(tasks.markQueued).toHaveBeenCalledWith("t1");
  });
});

describe("EngineController — reject", () => {
  it("rejects a paused task: fails it with 'Rejected by <user>' and audits", async () => {
    const tasks = makeTasksStub();
    tasks.findOne.mockResolvedValueOnce({ id: "t1", status: "paused" });
    const { controller, audit } = makeController(makeAvailability(true), tasks);

    const result = await controller.rejectTask("t1", user);

    expect(result).toEqual({ id: "t1", status: "failed", reason: "Rejected by a@b.c" });
    // Engine v0.5: reject records the "rejected" failure classification.
    expect(tasks.markFailed).toHaveBeenCalledWith("t1", "Rejected by a@b.c", "rejected");
    expect(audit.record).toHaveBeenCalledWith("user-1", "engine.task.rejected", "t1", { actor: "a@b.c" });
  });

  it("rejects rejecting a task that is not paused", async () => {
    const tasks = makeTasksStub();
    tasks.findOne.mockResolvedValueOnce({ id: "t1", status: "completed" });
    const { controller, audit } = makeController(makeAvailability(true), tasks);

    await expect(controller.rejectTask("t1", user)).rejects.toBeInstanceOf(BadRequestException);
    expect(tasks.markFailed).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("404s when the task does not exist", async () => {
    const { controller } = makeController();
    await expect(controller.rejectTask("nope", user)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("EngineController — v0.5 dead-letter + alerts endpoints", () => {
  it("GET deadletters returns the classified failed tasks list", async () => {
    const tasks = makeTasksStub();
    tasks.findAllFailed.mockResolvedValueOnce([{ id: "t1", status: "failed", failureClassification: "stalled", error: "x" }]);
    const { controller } = makeController(makeAvailability(true), tasks);
    await expect(controller.listDeadLetters()).resolves.toEqual([
      { id: "t1", status: "failed", failureClassification: "stalled", error: "x" },
    ]);
    expect(tasks.findAllFailed).toHaveBeenCalledTimes(1);
  });

  it("GET alerts returns the alert summary", async () => {
    const alerts = makeAlertsStub();
    alerts.getAlertSummary.mockResolvedValueOnce([{ at: "x", type: "engine.task.failed", taskId: "t1", detail: null }]);
    const { controller } = makeController(makeAvailability(true), makeTasksStub(), makeQueueStub(), makeModelStub(), makeAuditStub(), makeSchedulerStub(), makeSupervisorStub(), alerts);
    await expect(controller.listAlerts()).resolves.toEqual([
      { at: "x", type: "engine.task.failed", taskId: "t1", detail: null },
    ]);
  });
});
