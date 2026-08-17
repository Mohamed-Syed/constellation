import { describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { EngineAlertService } from "./engine-alerts.service.js";
import type { EngineAvailabilityService } from "./engine-availability.service.js";
import { SupervisorService, DEFAULT_SUPERVISOR_INTERVAL_MS, DEFAULT_STALE_TASK_MS } from "./supervisor.service.js";
import type { TaskQueueService } from "./task-queue.service.js";
import type { TaskService } from "./task.service.js";

/**
 * SupervisorService tests (Engine v0.5 — stuck-task detection). The offline
 * suite drives the public `runSweep(now)` seam directly with a fake clock; it
 * never constructs a real timer (start()/onModuleInit not called) and never
 * touches a real Redis/DB. Collaborators (TaskService, TaskQueueService,
 * EngineAvailabilityService, EngineAlertService) are `vi.fn()` fakes injected
 * via the constructor.
 *
 * Contracts under test:
 *  1. A stale `running` task whose BullMQ job is NOT active is re-enqueued
 *     once (resume), marked stallRetried, and a recovered alert fires.
 *  2. A task already `stallRetried` that is stale AGAIN is failed with a
 *     `stalled` classification (no infinite re-enqueue) + a failed alert.
 *  3. RACE GUARD: a stale task with an ACTIVE BullMQ job is SKIPPED (never
 *     double-run) even if it looks stale.
 *  4. Disabled engine -> ran:false, no churn.
 *  5. getHealth() reports poll interval, staleThresholdMs, last sweep, counters.
 */

function makeAvailability(enabled: boolean): EngineAvailabilityService {
  return { isEnabled: enabled, reason: enabled ? null : "Redis unreachable" } as unknown as EngineAvailabilityService;
}

function makeTasks(overrides: Record<string, unknown> = {}): TaskService {
  return {
    findStaleRunning: vi.fn(async () => []),
    markResumed: vi.fn(async () => true),
    markStallRetried: vi.fn(async () => true),
    markFailed: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as TaskService;
}

function makeQueue(overrides: Record<string, unknown> = {}): TaskQueueService {
  return {
    getActiveTaskIds: vi.fn(async () => new Set<string>()),
    enqueue: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as TaskQueueService;
}

function makeAlerts(): EngineAlertService {
  return {
    recordTaskFailed: vi.fn(),
    recordTaskStale: vi.fn(),
    recordTaskRecovered: vi.fn(),
  } as unknown as EngineAlertService;
}

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: vi.fn((key: string, fallback?: unknown) => (key in overrides ? overrides[key] : fallback)),
  } as unknown as ConfigService;
}

const NOW = new Date("2026-08-03T12:00:00.000Z");
const OLD = new Date("2026-08-03T11:00:00.000Z"); // 1h ago — stale (threshold 5min)

function supervisor(opts: {
  availability?: EngineAvailabilityService;
  tasks?: TaskService;
  queue?: TaskQueueService;
  alerts?: EngineAlertService;
  staleTaskMs?: number;
  pollIntervalMs?: number;
} = {}): {
  svc: SupervisorService;
  tasks: TaskService;
  queue: TaskQueueService;
  alerts: EngineAlertService;
} {
  const tasks = opts.tasks ?? makeTasks();
  const queue = opts.queue ?? makeQueue();
  const alerts = opts.alerts ?? makeAlerts();
  const svc = new SupervisorService(
    tasks,
    queue,
    opts.availability ?? makeAvailability(true),
    alerts,
    makeConfig({}),
    { now: () => NOW, staleTaskMs: opts.staleTaskMs ?? DEFAULT_STALE_TASK_MS, pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_SUPERVISOR_INTERVAL_MS },
  );
  return { svc, tasks, queue, alerts };
}

function staleTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t1",
    status: "running",
    updatedAt: OLD,
    error: null,
    failureClassification: null,
    stallRetried: false,
    stepCount: 2,
    ...overrides,
  };
}

describe("SupervisorService — recover a genuinely stalled task (resume-once)", () => {
  it("re-enqueues a stale non-active task once, marks stallRetried, and fires recovered alert", async () => {
    const tasks = makeTasks({ findStaleRunning: vi.fn(async () => [staleTask()]) });
    const { svc, tasks: t, queue, alerts } = supervisor({ tasks });

    const result = await svc.runSweep(NOW);

    expect(result).toEqual({ ran: true, staleFound: 1, recovered: 1, failedStalled: 0, skippedActive: 0 });
    expect(t.markResumed).toHaveBeenCalledWith("t1");
    expect(t.markStallRetried).toHaveBeenCalledWith("t1");
    expect(queue.enqueue).toHaveBeenCalledWith("t1");
    expect(alerts.recordTaskStale).toHaveBeenCalledWith("t1", NOW.getTime() - OLD.getTime());
    expect(alerts.recordTaskRecovered).toHaveBeenCalledWith("t1");
    expect(t.markFailed).not.toHaveBeenCalled();
  });

  it("does NOT re-enqueue a stale task whose BullMQ job is ACTIVE (race guard, no double-run)", async () => {
    const tasks = makeTasks({ findStaleRunning: vi.fn(async () => [staleTask()]) });
    const queue = makeQueue({ getActiveTaskIds: vi.fn(async () => new Set(["t1"])) });
    const { svc, tasks: t, alerts } = supervisor({ tasks, queue });

    const result = await svc.runSweep(NOW);

    expect(result).toEqual({ ran: true, staleFound: 1, recovered: 0, failedStalled: 0, skippedActive: 1 });
    expect(t.markResumed).not.toHaveBeenCalled();
    expect(t.markStallRetried).not.toHaveBeenCalled();
    expect(alerts.recordTaskRecovered).not.toHaveBeenCalled();
  });
});

describe("SupervisorService — a re-stale task becomes a stalled dead letter", () => {
  it("marks a task that is stale again after a resume attempt as failed with 'stalled'", async () => {
    const tasks = makeTasks({
      findStaleRunning: vi.fn(async () => [staleTask({ stallRetried: true, updatedAt: OLD })]),
    });
    const { svc, tasks: t, alerts } = supervisor({ tasks });

    const result = await svc.runSweep(NOW);

    expect(result).toEqual({ ran: true, staleFound: 1, recovered: 0, failedStalled: 1, skippedActive: 0 });
    expect(t.markResumed).not.toHaveBeenCalled();
    expect(t.markFailed).toHaveBeenCalledWith("t1", expect.stringContaining("stalled after resume attempt"), "stalled");
    expect(alerts.recordTaskFailed).toHaveBeenCalledWith("t1", "stalled", expect.stringContaining("stalled after resume attempt"));
  });
});

describe("SupervisorService — degradation + health", () => {
  it("returns ran:false when the engine is disabled (no churn)", async () => {
    const { svc, tasks } = supervisor({ availability: makeAvailability(false) });
    const result = await svc.runSweep(NOW);
    expect(result).toEqual({ ran: false, staleFound: 0, recovered: 0, failedStalled: 0, skippedActive: 0 });
    expect(
      (tasks as unknown as { findStaleRunning: ReturnType<typeof vi.fn> }).findStaleRunning,
    ).not.toHaveBeenCalled();
  });

  it("reports health with poll interval, stale threshold, sweep timestamp and counter totals", async () => {
    const tasks = makeTasks({ findStaleRunning: vi.fn(async () => [staleTask()]) });
    const { svc } = supervisor({ tasks, staleTaskMs: 300000, pollIntervalMs: 45000 });
    await svc.runSweep(NOW);
    const health = await svc.getHealth();
    expect(health).toMatchObject({
      enabled: true,
      pollIntervalMs: 45000,
      staleThresholdMs: 300000,
      staleFound: 1,
      recovered: 1,
      failedStalled: 0,
    });
    expect(health.lastSweepAt).toBe(NOW.toISOString());
  });
});
