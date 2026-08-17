import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventBusService } from "../events/event-bus.service.js";
import { EngineAlertService, DEFAULT_ALERT_BUFFER_CAP } from "./engine-alerts.service.js";

/**
 * EngineAlertService tests (Engine v0.5 — event-based alerting surface).
 * Hand-wired with `new`. The only external seam is the optional EventBus,
 * injected as a `vi.fn()` fake; every emission is SAFE (absent bus or a
 * throwing emit must never crash).
 *
 * Contracts under test:
 *  1. recordTaskFailed/Stale/Recovered append to the in-memory ring buffer
 *     (newest first) and emit the corresponding "engine.task.*" event.
 *  2. The buffer is capped (oldest dropped).
 *  3. An absent EventBus (`undefined`) resolves and never throws.
 *  4. A throwing emit is caught and never propagates.
 */

function makeEventBus(): { bus: EventBusService; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  const bus = {
    forPlugin: () => ({ emit, onPlatform: vi.fn() }),
  } as unknown as EventBusService;
  return { bus, emit };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("EngineAlertService — ring buffer", () => {
  it("records a failed-task alert and emits engine.task.failed on the core scope", () => {
    const { bus, emit } = makeEventBus();
    const svc = new EngineAlertService(bus, DEFAULT_ALERT_BUFFER_CAP);

    svc.recordTaskFailed("t1", "terminal", "boom");

    const summary = svc.getAlertSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0]!.type).toBe("engine.task.failed");
    expect(summary[0]!.taskId).toBe("t1");
    expect(summary[0]!.detail).toBe("boom");
    expect(summary[0]!.at).toBeTruthy();
    expect(emit).toHaveBeenCalledWith(
      "engine.task.failed",
      expect.objectContaining({ taskId: "t1", classification: "terminal", detail: "boom" }),
    );
  });

  it("records a stale and a recovered alert with the right topics", () => {
    const { bus } = makeEventBus();
    const svc = new EngineAlertService(bus, 50);
    svc.recordTaskStale("t1", 3600000);
    svc.recordTaskRecovered("t1");
    const summary = svc.getAlertSummary();
    expect(summary.map((a) => a.type)).toEqual(["engine.task.recovered", "engine.task.stale"]);
    expect(summary[1]!.detail).toBe("3600000ms");
  });

  it("records completed and paused alerts (notification channels round)", () => {
    const { bus, emit } = makeEventBus();
    const svc = new EngineAlertService(bus, 50);
    svc.recordTaskCompleted("t2");
    svc.recordTaskPaused("t3");
    const summary = svc.getAlertSummary();
    expect(summary.map((a) => a.type)).toEqual(["engine.task.paused", "engine.task.completed"]);
    expect(summary[0]!.taskId).toBe("t3");
    expect(summary[1]!.taskId).toBe("t2");
    expect(emit).toHaveBeenCalledWith("engine.task.completed", expect.objectContaining({ taskId: "t2" }));
    expect(emit).toHaveBeenCalledWith("engine.task.paused", expect.objectContaining({ taskId: "t3", detail: "awaiting approval" }));
  });

  it("caps the buffer at the configured limit (oldest dropped)", () => {
    const svc = new EngineAlertService(undefined, 3);
    svc.recordTaskFailed("t1", "terminal", "e1");
    svc.recordTaskFailed("t2", "stalled", "e2");
    svc.recordTaskFailed("t3", "transient_exhausted", "e3");
    svc.recordTaskFailed("t4", "rejected", "e4");
    const summary = svc.getAlertSummary();
    expect(summary).toHaveLength(3);
    expect(summary[0]!.taskId).toBe("t4"); // newest first
    expect(summary[2]!.taskId).toBe("t2"); // oldest kept
  });
});

describe("EngineAlertService — safety", () => {
  it("never throws when no EventBus is injected", () => {
    const svc = new EngineAlertService(undefined, 10);
    expect(() => svc.recordTaskFailed("t1", "terminal", "boom")).not.toThrow();
    expect(svc.getAlertSummary()).toHaveLength(1);
  });

  it("catches a throwing emit and still records the alert", () => {
    const bus = {
      forPlugin: () => ({
        emit: () => {
          throw new Error("bus exploded");
        },
      }),
    } as unknown as EventBusService;
    const svc = new EngineAlertService(bus, 10);
    expect(() => svc.recordTaskRecovered("t1")).not.toThrow();
    expect(svc.getAlertSummary()).toHaveLength(1);
  });
});
