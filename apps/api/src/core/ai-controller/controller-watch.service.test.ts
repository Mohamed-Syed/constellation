import { describe, expect, it, vi } from "vitest";
import { ControllerService } from "./controller.service.js";
import { ControllerWatchService } from "./controller-watch.service.js";

/**
 * ControllerWatchService — Phase 5.0 HEAL slice. The autonomous loop: gathers
 * the same live signals as /status, runs the monitor, notifies on score
 * transitions, and executes due whitelisted-safe recovery actions by itself,
 * with per-action cooldowns + an overlap guard + full auditing.
 */

const UP_TOPOLOGY = { counts: { total: 1, up: 1, down: 0, unknown: 0 }, peers: [], probeIntervalMs: 5000 };
const DOWN_TOPOLOGY = {
  counts: { total: 2, up: 1, down: 1, unknown: 0 },
  peers: [{ id: "p1", name: "dark-site", baseUrl: "http://localhost:4999", apiKeyHash: null, status: "down", lastSeen: null, lastError: "ECONNREFUSED", lastProbedAt: null }],
  probeIntervalMs: 5000,
};

function services() {
  const mesh = { topology: vi.fn().mockResolvedValue(UP_TOPOLOGY), probeAll: vi.fn().mockResolvedValue({ ran: true, probed: 1, up: 1, down: 0 }) };
  const scheduler = { getHealth: vi.fn().mockResolvedValue({ enabled: true }) };
  const supervisor = { getHealth: vi.fn().mockResolvedValue({ enabled: true }), runSweep: vi.fn().mockResolvedValue({ ran: true, staleFound: 0, recovered: 0, failedStalled: 0, skippedActive: 0 }) };
  const queue = { getHealth: vi.fn().mockResolvedValue({ enabled: true }), enqueue: vi.fn().mockResolvedValue(undefined) };
  const tasks = {
    getFailedCount: vi.fn().mockResolvedValue(0),
    findAllFailed: vi.fn().mockResolvedValue([]),
    requeue: vi.fn().mockResolvedValue(true),
  };
  const plugins = { summary: () => ({ total: 3, failed: 0, enabled: 3, disabled: 0, degradedOrDown: 0 }) };
  const notifications = { record: vi.fn().mockResolvedValue(undefined) };
  return { mesh, scheduler, supervisor, queue, tasks, plugins, notifications };
}

function build(s: ReturnType<typeof services>) {
  const controller = new ControllerService(s.mesh as never, s.tasks as never, s.queue as never, s.supervisor as never, s.plugins as never);
  const watch = new ControllerWatchService(controller, s.mesh as never, s.tasks as never, s.queue as never, s.scheduler as never, s.supervisor as never, s.plugins as never, s.notifications as never);
  return { controller, watch };
}

describe("ControllerWatchService — autonomous HEAL loop", () => {
  it("ticks: gathers live signals, runs the monitor, records lastTickAt", async () => {
    const s = services();
    const { watch } = build(s);
    const snap = await watch.tick(1_000_000);
    expect(snap).not.toBeNull();
    expect(snap!.score).toBe(100);
    expect(snap!.label).toBe("Healthy");
    expect(watch.status().lastTickAt).not.toBeNull();
    expect(watch.status().lastScore).toBe(100);
    // Every signal source was consulted.
    expect(s.mesh.topology).toHaveBeenCalled();
    expect(s.scheduler.getHealth).toHaveBeenCalled();
    expect(s.supervisor.getHealth).toHaveBeenCalled();
    expect(s.queue.getHealth).toHaveBeenCalled();
    expect(s.tasks.getFailedCount).toHaveBeenCalled();
  });

  it("heals autonomously: dead letters → re-enqueue-deadletters, audited", async () => {
    const s = services();
    s.tasks.getFailedCount.mockResolvedValue(2);
    s.tasks.findAllFailed.mockResolvedValue([{ id: "dl1" }, { id: "dl2" }]);
    const { watch } = build(s);
    const snap = await watch.tick(1_000_000);
    expect(snap!.findings.some((f) => f.id === "dead-letter")).toBe(true);
    expect(watch.status().lastAction).toBe("re-enqueue-deadletters");
    expect(watch.status().lastActionAt).not.toBeNull();
    // The recovery actually ran against the services.
    expect(s.queue.enqueue).toHaveBeenCalledTimes(2);
    expect(s.tasks.requeue).toHaveBeenCalledTimes(2);
    // Audited as an autonomous action.
    const audit = s.notifications.record.mock.calls.find((c) => c[0] === "ai-controller.autonomous");
    expect(audit).toBeDefined();
    expect(audit![1]).toBe("info");
    expect(audit![4]).toBe("ai-controller");
    expect(audit![5]).toBe("re-enqueue-deadletters");
  });

  it("heals autonomously: down mesh peer → reprobe-mesh", async () => {
    const s = services();
    s.mesh.topology.mockResolvedValue(DOWN_TOPOLOGY);
    const { watch } = build(s);
    await watch.tick(1_000_000);
    expect(watch.status().lastAction).toBe("reprobe-mesh");
    expect(s.mesh.probeAll).toHaveBeenCalled();
  });

  it("respects the per-action cooldown: no repeat within the window", async () => {
    const s = services();
    s.tasks.getFailedCount.mockResolvedValue(2);
    s.tasks.findAllFailed.mockResolvedValue([{ id: "dl1" }]);
    const { controller, watch } = build(s);
    const actSpy = vi.spyOn(controller, "act");
    await watch.tick(1_000_000);
    expect(watch.status().lastAction).toBe("re-enqueue-deadletters");
    expect(actSpy).toHaveBeenCalledTimes(1);
    actSpy.mockClear();

    // 10 s later: the 15-min re-enqueue cooldown has NOT elapsed → no repeat.
    await watch.tick(1_000_000 + 10_000);
    expect(actSpy).not.toHaveBeenCalled();
    expect(s.queue.enqueue).toHaveBeenCalledTimes(1); // still just the first run

    // After the cooldown elapses the action may run again.
    await watch.tick(1_000_000 + 900_000 + 1);
    expect(actSpy).toHaveBeenCalledTimes(1);
    expect(s.queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it("never overlaps: a concurrent tick is dropped", async () => {
    const s = services();
    s.tasks.getFailedCount.mockResolvedValue(2);
    const { watch } = build(s);
    const first = watch.tick(1_000_000);
    const second = await watch.tick(1_000_000);
    expect(second).toBeNull();
    await first;
  });

  it("never runs non-autonomous recommendations (engine-down advice)", async () => {
    const act = vi.fn(async () => ({ ok: true, ran: true, message: "should never run" }));
    const controller = {
      monitor: async () => ({
        generatedAt: new Date().toISOString(),
        score: 10,
        label: "Critical",
        findings: [{ id: "engine-down", severity: "crit", area: "engine", title: "Engine unavailable", detail: "x" }],
        actionsRecommended: ["check Redis and the engine worker"],
      }),
      act,
    };
    const watch = new ControllerWatchService(controller as never);
    await watch.tick(1_000_000);
    expect(act).not.toHaveBeenCalled();
  });

  it("keeps run-deepseek-diagnostic OUT of the autonomous set", () => {
    expect(ControllerWatchService["AUTONOMOUS_ACTIONS"].has("run-deepseek-diagnostic")).toBe(false);
    expect(ControllerWatchService["AUTONOMOUS_ACTIONS"].has("re-enqueue-deadletters")).toBe(true);
  });

  it("never executes advice it cannot perform (supervisor-down → 'restart the api process')", async () => {
    const s = services();
    s.supervisor.getHealth.mockResolvedValue({ enabled: false });
    const { controller, watch } = build(s);
    const actSpy = vi.spyOn(controller, "act");
    const snap = await watch.tick(1_000_000);
    // A disabled supervisor yields the supervisor-down finding; its
    // recommendation is "restart the api process" — the watch must NOT try to
    // run that (it is advice for a human, not an autonomous action).
    expect(snap!.findings.some((f) => f.id === "supervisor-down")).toBe(true);
    expect(actSpy).not.toHaveBeenCalled();
    expect(watch.status().lastAction).toBeNull();
    expect(s.notifications.record.mock.calls.filter((c) => c[0] === "ai-controller.autonomous")).toHaveLength(0);
  });

  it("watches score transitions: notifies on degradation and recovery", async () => {
    const s = services();
    // Tick 1: 1 down mesh peer + 2 dead letters → Degraded (80).
    s.mesh.topology.mockResolvedValueOnce(DOWN_TOPOLOGY).mockResolvedValue(UP_TOPOLOGY);
    s.tasks.getFailedCount.mockResolvedValueOnce(2).mockResolvedValue(0);
    const { watch } = build(s);

    await watch.tick(1_000_000);
    expect(watch.status().lastLabel).toBe("Degraded");
    // First tick establishes the baseline — no transition notification yet.
    expect(s.notifications.record.mock.calls.filter((c) => c[0] === "ai-controller.watch")).toHaveLength(0);

    // Tick 2: platform recovered → Healthy → transition notified.
    await watch.tick(2_000_000);
    expect(watch.status().lastLabel).toBe("Healthy");
    const transition = s.notifications.record.mock.calls.find((c) => c[0] === "ai-controller.watch");
    expect(transition).toBeDefined();
    expect(transition![5]).toBe("recovered");
    expect(transition![3]).toContain("Healthy");
  });

  it("degrades to an honest snapshot with no services wired (never throws)", async () => {
    const watch = new ControllerWatchService(new ControllerService());
    const snap = await watch.tick(1_000_000);
    expect(snap).not.toBeNull();
    expect(snap!.findings.some((f) => f.id === "mesh-unknown")).toBe(true);
    expect(watch.status().lastTickAt).not.toBeNull();
  });

  it("survives a throwing monitor (logs + returns null, next tick retries)", async () => {
    const controller = {
      monitor: vi.fn().mockRejectedValue(new Error("boom")),
      act: vi.fn(),
    };
    const watch = new ControllerWatchService(controller as never);
    const snap = await watch.tick(1_000_000);
    expect(snap).toBeNull();
    controller.monitor.mockResolvedValue({
      generatedAt: new Date().toISOString(),
      score: 100,
      label: "Healthy",
      findings: [],
      actionsRecommended: [],
    });
    const snap2 = await watch.tick(2_000_000);
    expect(snap2?.label).toBe("Healthy");
  });
});
