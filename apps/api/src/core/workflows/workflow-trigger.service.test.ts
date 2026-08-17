import { describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { WorkflowTriggerService } from "./workflow-trigger.service.js";
import type { ScheduledTaskService } from "../engine/scheduled-task.service.js";
import type { WorkflowRunService } from "./workflow-run.service.js";
import type { EventBusService } from "../events/event-bus.service.js";

const WF = (overrides: Record<string, unknown> = {}) => ({
  id: "w1",
  name: "Digest",
  definition: { trigger: { type: "cron", cron: "* * * * *" } },
  ...overrides,
});

function makeSchedules(overrides: Record<string, unknown> = {}) {
  return {
    findAll: vi.fn(async () => []),
    create: vi.fn(async (dto: unknown) => ({ id: "sched-1", ...(dto as object) })),
    remove: vi.fn(async () => true),
    ...overrides,
  } as unknown as ScheduledTaskService;
}

function makeBus() {
  const coreOn: Array<[string, (payload: unknown) => void]> = [];
  const platformOn: Array<[string, (payload: unknown) => void]> = [];
  const bus = {
    forPlugin: () => ({
      on: (t: string, h: (p: unknown) => void) => void coreOn.push([t, h]),
      onPlatform: (t: string, h: (p: unknown) => void) => void platformOn.push([t, h]),
      emit: vi.fn(),
    }),
    emitPlatform: vi.fn(),
  } as unknown as EventBusService;
  return { bus, coreOn, platformOn };
}

function svcWith(schedules: ScheduledTaskService, bus?: EventBusService, runs?: WorkflowRunService) {
  const runService = (runs ?? { run: vi.fn(async () => ({ id: "r1", workflowId: "w1", status: "running" })) }) as unknown as WorkflowRunService;
  return new WorkflowTriggerService(schedules, runService, bus);
}

describe("WorkflowTriggerService — cron triggers", () => {
  it("creates a workflow ScheduledTask (workflowId set) for a cron trigger", async () => {
    const schedules = makeSchedules();
    const svc = svcWith(schedules);
    await svc.sync(WF());
    expect(schedules.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "workflow:w1",
        kind: "cron",
        cron: "* * * * *",
        workflowId: "w1",
        task: { title: "Workflow: Digest", prompt: "", maxSteps: 1 },
      }),
    );
  });

  it("replaces an existing schedule on re-sync (id may rotate, name is stable)", async () => {
    const schedules = makeSchedules({
      findAll: vi.fn(async () => [{ id: "old-sched", name: "workflow:w1" }]),
    });
    const svc = svcWith(schedules);
    await svc.sync(WF());
    expect(schedules.remove).toHaveBeenCalledWith("old-sched");
    expect(schedules.create).toHaveBeenCalled();
  });

  it("removes the schedule when the trigger is manual/absent", async () => {
    const schedules = makeSchedules({
      findAll: vi.fn(async () => [{ id: "old-sched", name: "workflow:w1" }]),
    });
    const svc = svcWith(schedules);
    await svc.sync(WF({ definition: { trigger: { type: "manual" } } }));
    expect(schedules.remove).toHaveBeenCalledWith("old-sched");
    expect(schedules.create).not.toHaveBeenCalled();
  });
});

describe("WorkflowTriggerService — event triggers", () => {
  it("arms listeners on BOTH scopes and runs the workflow when the event fires", async () => {
    const { bus, coreOn, platformOn } = makeBus();
    const runs = { run: vi.fn(async () => ({ id: "r1", workflowId: "w1", status: "running" })) };
    const schedules = makeSchedules();
    const svc = svcWith(schedules, bus, runs as unknown as WorkflowRunService);
    await svc.sync(WF({ definition: { trigger: { type: "event", event: "engine.task.failed" } } }));
    expect(coreOn.some(([t]) => t === "engine.task.failed")).toBe(true);
    expect(platformOn.some(([t]) => t === "engine.task.failed")).toBe(true);
    coreOn[0]![1]({ taskId: "t1" });
    await Promise.resolve();
    await Promise.resolve();
    expect(runs.run).toHaveBeenCalledWith("w1");
  });

  it("deactivates the listener when the trigger changes away from event", async () => {
    const { bus, coreOn } = makeBus();
    const runs = { run: vi.fn(async () => ({ id: "r1", workflowId: "w1", status: "running" })) };
    const svc = svcWith(makeSchedules(), bus, runs as unknown as WorkflowRunService);
    await svc.sync(WF({ definition: { trigger: { type: "event", event: "engine.task.failed" } } }));
    await svc.sync(WF({ definition: { trigger: { type: "manual" } } }));
    coreOn[0]![1]({ taskId: "t1" });
    await Promise.resolve();
    expect(runs.run).not.toHaveBeenCalled();
  });
});

describe("WorkflowTriggerService — remove + degrade", () => {
  it("remove deletes the schedule and disarms the listener", async () => {
    const { bus, coreOn } = makeBus();
    const runs = { run: vi.fn(async () => ({ id: "r1", workflowId: "w1", status: "running" })) };
    const schedules = makeSchedules({
      findAll: vi.fn(async () => [{ id: "old-sched", name: "workflow:w1" }]),
    });
    const svc = svcWith(schedules, bus, runs as unknown as WorkflowRunService);
    await svc.sync(WF({ definition: { trigger: { type: "event", event: "engine.task.failed" } } }));
    await svc.remove("w1");
    expect(schedules.remove).toHaveBeenCalledWith("old-sched");
    coreOn[0]![1]({ taskId: "t1" });
    await Promise.resolve();
    expect(runs.run).not.toHaveBeenCalled();
  });

  it("never throws when the schedule layer fails (sync is best-effort)", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const schedules = makeSchedules({ findAll: vi.fn(async () => { throw new Error("db down"); }) });
    const svc = svcWith(schedules);
    await expect(svc.sync(WF())).resolves.toBeUndefined();
    await expect(svc.remove("w1")).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
