import { describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { EventBusService } from "../events/event-bus.service.js";
import type { EngineAvailabilityService } from "./engine-availability.service.js";
import type { ScheduledTaskService } from "./scheduled-task.service.js";
import type { EngineAvailabilityService as EA } from "./engine-availability.service.js";
import { SchedulerEngineService } from "./scheduler-engine.service.js";
import type { TaskQueueService } from "./task-queue.service.js";
import type { TaskService } from "./task.service.js";

/**
 * SchedulerEngineService tests (Engine v0.4 — scheduler poll loop + event
 * triggers). The offline suite drives the PUBLIC seams — runSweep(now) and
 * fireSchedule(...) — directly with a fake clock; it never constructs a real
 * timer (start()/onModuleInit are not called) and never touches a real
 * EventBus. Collaborators (ScheduledTaskService, TaskService, TaskQueueService,
 * EngineAvailabilityService) are `vi.fn()` fakes injected via the constructor.
 *
 * Contracts under test:
 *  1. runSweep() lists DUE cron schedules and enqueues exactly one task each,
 *     advancing run bookkeeping (fireSchedule -> markRun).
 *  2. A per-schedule enqueue failure records an honest lastError and advances
 *     nextRunAt (no spin) — errors are counted, not thrown.
 *  3. Disabled engine -> ran:false, no churn.
 *  4. Overlapping sweep is skipped.
 *  5. fireSchedule enqueues the schedule's task template (title/prompt/model/
 *     maxSteps/maxTokens) and marks run.
 *  6. Event-triggered schedules fire via a listener (through a fake eventBus
 *     subscription captured by onPlatform) and skip the clock poll.
 */

function makeAvailability(enabled: boolean): EngineAvailabilityService {
  return {
    isEnabled: enabled,
    reason: enabled ? null : "Redis unreachable at localhost:6380",
  } as unknown as EngineAvailabilityService;
}

function makeScheduledTasks(overrides: Record<string, unknown> = {}): ScheduledTaskService {
  return {
    findAll: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
    listDueCronSchedules: vi.fn(async () => []),
    listEnabledEventSchedules: vi.fn(async () => []),
    markRun: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ScheduledTaskService;
}

function makeTasks(): TaskService {
  return {
    create: vi.fn(async (dto: unknown) => ({ id: "task-1", ...(dto as object) })),
  } as unknown as TaskService;
}

function makeQueue(): TaskQueueService {
  return { enqueue: vi.fn(async () => undefined) } as unknown as TaskQueueService;
}

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: vi.fn((key: string, fallback?: unknown) => {
      if (key in overrides) return overrides[key];
      return fallback;
    }),
  } as unknown as ConfigService;
}

const NOW = new Date("2026-08-03T12:00:00.000Z");

function engine(opts: {
  availability?: EngineAvailabilityService;
  scheduledTasks?: ScheduledTaskService;
  tasks?: TaskService;
  queue?: TaskQueueService;
  eventBus?: EventBusService;
  pollIntervalMs?: number;
} = {}): {
  svc: SchedulerEngineService;
  scheduledTasks: ScheduledTaskService;
  tasks: TaskService;
  queue: TaskQueueService;
} {
  const scheduledTasks = opts.scheduledTasks ?? makeScheduledTasks();
  const tasks = opts.tasks ?? makeTasks();
  const queue = opts.queue ?? makeQueue();
  const svc = new SchedulerEngineService(
    scheduledTasks,
    tasks,
    queue,
    opts.availability ?? makeAvailability(true),
    opts.eventBus === undefined ? undefined : opts.eventBus,
    makeConfig({}),
    {
      now: () => NOW,
      pollIntervalMs: opts.pollIntervalMs ?? 30_000,
    },
  );
  return { svc, scheduledTasks, tasks, queue };
}

describe("SchedulerEngineService — runSweep (cron poll loop)", () => {
  it("enqueues exactly one task per due schedule and marks it run", async () => {
    const { svc, scheduledTasks, tasks, queue } = engine({
      scheduledTasks: makeScheduledTasks({
        listDueCronSchedules: vi.fn(
          async () => [
            {
              id: "s1",
              title: "Digest",
              prompt: "Summarize.",
              model: "qwen2.5-coder:7b",
              maxSteps: 5,
              maxTokens: 2000,
              kind: "cron",
            },
          ],
        ),
      }),
    });

    const result = await svc.runSweep(NOW);

    expect(result).toEqual({ swept: 1, fired: 1, errors: 0, ran: true });
    expect(tasks.create).toHaveBeenCalledWith(
      {
        title: "Digest",
        prompt: "Summarize.",
        model: "qwen2.5-coder:7b",
        maxSteps: 5,
        maxTokens: 2000,
      },
      undefined,
    );
    expect(queue.enqueue).toHaveBeenCalledWith("task-1");
    expect((scheduledTasks as unknown as { markRun: ReturnType<typeof vi.fn> }).markRun).toHaveBeenCalledWith(
      "s1",
      NOW,
    );
  });

  it("counts errors and records lastError (advancing nextRunAt via markRun(err)) when a schedule fails to enqueue", async () => {
    const tasks = makeTasks();
    (tasks.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("redis down"));
    const scheduledTasks = makeScheduledTasks({
      listDueCronSchedules: vi.fn(
        async () => [
          {
            id: "s1",
            title: "Digest",
            prompt: "Summarize.",
            model: null,
            maxSteps: 5,
            maxTokens: null,
            kind: "cron",
          },
        ],
      ),
    });

    const { svc } = engine({ scheduledTasks, tasks });
    const result = await svc.runSweep(NOW);

    expect(result.errors).toBe(1);
    expect(result.fired).toBe(0);
    // markRun(err) advances nextRunAt so the loop does not spin, and records the error.
    expect((scheduledTasks as unknown as { markRun: ReturnType<typeof vi.fn> }).markRun).toHaveBeenCalledWith(
      "s1",
      NOW,
      "redis down",
    );
  });

  it("returns ran:false (no churn) when the engine is disabled", async () => {
    const { svc, scheduledTasks } = engine({ availability: makeAvailability(false) });
    const result = await svc.runSweep(NOW);
    expect(result).toEqual({ swept: 0, fired: 0, errors: 0, ran: false });
    expect(
      (scheduledTasks as unknown as { listDueCronSchedules: ReturnType<typeof vi.fn> })
        .listDueCronSchedules,
    ).not.toHaveBeenCalled();
  });

  it("skips an overlapping sweep (sweeping guard)", async () => {
    const scheduledTasks = makeScheduledTasks({
      // First call returns due; a second overlapping call would also resolve but
      // the guard should stop it. We simulate overlap by leaving sweeping=true.
      listDueCronSchedules: vi.fn(async () => []),
    });
    const { svc } = engine({ scheduledTasks });
    // Prime the guard by starting a sweep that never finishes.
    (svc as unknown as { sweeping: boolean }).sweeping = true;
    const result = await svc.runSweep(NOW);
    expect(result.ran).toBe(false);
  });

  it("exposes getHealth with the poll interval and last sweep", async () => {
    const scheduledTasks = makeScheduledTasks({
      listDueCronSchedules: vi.fn(
        async () => [
          {
            id: "s1",
            title: "T",
            prompt: "P",
            model: null,
            maxSteps: 5,
            maxTokens: null,
            kind: "cron",
          },
        ],
      ),
    });
    const { svc } = engine({ scheduledTasks, pollIntervalMs: 60_000 });
    await svc.runSweep(NOW);
    const health = await svc.getHealth();
    expect(health).toMatchObject({
      enabled: true,
      pollIntervalMs: 60_000,
      dueCount: 1,
      registeredEvents: 0,
    });
    expect(health.lastSweepAt).toBe(NOW.toISOString());
  });
});

describe("SchedulerEngineService — fireSchedule", () => {
  it("enqueues the schedule's task template and marks run", async () => {
    const { svc, tasks, queue, scheduledTasks } = engine();
    const sched = {
      id: "s1",
      title: "Digest",
      prompt: "Summarize today.",
      model: null,
      maxSteps: 3,
      maxTokens: 500,
    };
    await svc.fireSchedule(sched, NOW);
    expect(tasks.create).toHaveBeenCalledWith(
      { title: "Digest", prompt: "Summarize today.", model: undefined, maxSteps: 3, maxTokens: 500 },
      undefined,
    );
    expect(queue.enqueue).toHaveBeenCalledWith("task-1");
    expect((scheduledTasks as unknown as { markRun: ReturnType<typeof vi.fn> }).markRun).toHaveBeenCalledWith(
      "s1",
      NOW,
    );
  });
});

describe("SchedulerEngineService — event-triggered schedules", () => {
  it("registers a listener per enabled event schedule via the EventBus and fires on the event", async () => {
    const handlers: Array<(payload: unknown) => void> = [];
    const eventBus = {
      forPlugin: () => ({
        onPlatform(topic: string, cb: (payload: unknown) => void): void {
          handlers.push(cb);
          void topic;
        },
      }),
    } as unknown as EventBusService;

    const scheduledTasks = makeScheduledTasks({
      findAll: vi.fn(async () => [
        {
          id: "s1",
          name: "on-enable",
          title: "T",
          prompt: "P",
          model: null,
          maxSteps: 5,
          maxTokens: null,
          kind: "event",
          spec: { event: "plugin.enabled" },
          enabled: true,
        },
      ]),
      findOne: vi.fn(
        async (id: string) =>
          id === "s1"
            ? {
                id: "s1",
                name: "on-enable",
                title: "T",
                prompt: "P",
                model: null,
                maxSteps: 5,
                maxTokens: null,
                kind: "event",
                enabled: true,
              }
            : null,
      ),
    });

    const { svc, tasks, queue } = engine({ scheduledTasks, eventBus });

    const registered = await svc.refreshEventListeners();
    expect(registered).toBe(1);
    expect(handlers).toHaveLength(1);

    // Fire the captured listener -> the event schedule enqueues a task (no clock poll).
    handlers[0]!("{ payload: true }");
    // The handler is fire-and-forget (`void this.onEventFired(...)`), so poll
    // until the async enqueue lands instead of racing the microtask.
    await vi.waitFor(() => expect(tasks.create).toHaveBeenCalledOnce());
    expect(queue.enqueue).toHaveBeenCalledWith("task-1");
    await vi.waitFor(() =>
      expect((scheduledTasks as unknown as { markRun: ReturnType<typeof vi.fn> }).markRun).toHaveBeenCalled(),
    );
  });

  it("does not register a listener when no EventBus is injected (offline boot)", async () => {
    const { svc } = engine({ eventBus: undefined });
    const registered = await svc.refreshEventListeners();
    expect(registered).toBe(0);
  });

  it("keeps registeredEvents count in health when listeners exist", async () => {
    const handlers: Array<(p: unknown) => void> = [];
    const eventBus = {
      forPlugin: () => ({
        onPlatform(_t: string, cb: (p: unknown) => void) {
          handlers.push(cb);
        },
      }),
    } as unknown as EventBusService;
    const scheduledTasks = makeScheduledTasks({
      findAll: vi.fn(async () => [
        {
          id: "s1",
          name: "on-event",
          title: "T",
          prompt: "P",
          model: null,
          maxSteps: 5,
          maxTokens: null,
          kind: "event",
          spec: { event: "x.y" },
          enabled: true,
        },
      ]),
    });
    const { svc } = engine({ scheduledTasks, eventBus });
    await svc.refreshEventListeners();
    const health = await svc.getHealth();
    expect(health.registeredEvents).toBe(1);
  });
});

describe("SchedulerEngineService — scheduler events on the bus (notification center)", () => {
  it("emits scheduler.schedule.fired after a successful fire", async () => {
    const emits: Array<[string, unknown]> = [];
    const eventBus = {
      forPlugin: () => ({
        onPlatform() {
          /* noop */
        },
        emit(topic: string, payload: unknown) {
          emits.push([topic, payload]);
        },
      }),
    } as unknown as EventBusService;
    const { svc } = engine({ eventBus });
    const sched = { id: "s1", title: "Digest", prompt: "Summarize today.", model: null, maxSteps: 3, maxTokens: 500 };
    await svc.fireSchedule(sched, NOW);
    expect(emits).toEqual([["scheduler.schedule.fired", { scheduleId: "s1", name: "Digest", taskId: "task-1" }]]);
  });

  it("emits scheduler.schedule.error when a cron sweep fire fails", async () => {
    const emits: Array<[string, unknown]> = [];
    const eventBus = {
      forPlugin: () => ({
        onPlatform() {
          /* noop */
        },
        emit(topic: string, payload: unknown) {
          emits.push([topic, payload]);
        },
      }),
    } as unknown as EventBusService;
    const tasks = makeTasks();
    (tasks.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("redis down"));
    const scheduledTasks = makeScheduledTasks({
      listDueCronSchedules: vi.fn(async () => [
        { id: "s1", name: "Digest", title: "Digest", prompt: "Summarize.", model: null, maxSteps: 5, maxTokens: null, kind: "cron" },
      ]),
    });
    const { svc } = engine({ scheduledTasks, tasks, eventBus });
    const result = await svc.runSweep(NOW);
    expect(result.errors).toBe(1);
    expect(emits).toEqual([["scheduler.schedule.error", { scheduleId: "s1", name: "Digest", error: "redis down" }]]);
  });

  it("stays silent (no emit) when the bus is absent", async () => {
    const { svc, tasks } = engine({ eventBus: undefined });
    const sched = { id: "s1", title: "Digest", prompt: "P", model: null, maxSteps: 3, maxTokens: null };
    await svc.fireSchedule(sched, NOW);
    expect(tasks.create).toHaveBeenCalled();
  });
});
