import { describe, expect, it, vi } from "vitest";
import { ControllerService } from "./controller.service.js";

describe("ControllerService — agentic AI controller (Phase 5.0 MONITOR slice)", () => {
  it("scores a healthy platform at 100 with 'ok' findings", async () => {
    const svc = new ControllerService();
    const snap = await svc.monitor({
      engineAvailable: true,
      queueOk: true,
      schedulerOk: true,
      supervisorOk: true,
      mesh: { counts: { total: 2, up: 2, down: 0, unknown: 0 }, peers: [], probeIntervalMs: 5000 },
    });
    expect(snap.score).toBe(100);
    expect(snap.label).toBe("Healthy");
    expect(snap.findings.some((f) => f.id === "engine-ok")).toBe(true);
    expect(snap.findings.some((f) => f.id === "mesh-ok")).toBe(true);
    expect(snap.actionsRecommended).toEqual([]);
  });

  it("flags a down engine + dead-letter + down mesh and drops the score", async () => {
    const svc = new ControllerService();
    const snap = await svc.monitor({
      engineAvailable: false,
      engineReason: "relay is down",
      queueOk: false,
      deadLetterTasks: 3,
      pluginsDegraded: 2,
      mesh: { counts: { total: 2, up: 1, down: 1, unknown: 0 }, peers: [], probeIntervalMs: 5000 },
    });
    expect(snap.score).toBeLessThan(70);
    expect(snap.label).not.toBe("Healthy");
    expect(snap.findings.some((f) => f.id === "engine-down")).toBe(true);
    expect(snap.findings.some((f) => f.id === "dead-letter")).toBe(true);
    const meshFinding = snap.findings.find((f) => f.id === "mesh-down")!;
    expect(meshFinding.severity).toBe("warn");
    expect(meshFinding.detail).toBe("One or more federated peers are unreachable or not responding.");
    const deadLetterFinding = snap.findings.find((f) => f.id === "dead-letter")!;
    expect(deadLetterFinding.detail).toContain("3 task(s) failed terminally");
    expect(snap.actionsRecommended).toContain("reprobe-mesh");
    expect(snap.actionsRecommended).toContain("re-enqueue-deadletters");
  });

  it("names the actual down peers in the mesh-down finding detail", async () => {
    const svc = new ControllerService();
    const snap = await svc.monitor({
      engineAvailable: true,
      mesh: {
        counts: { total: 2, up: 0, down: 2, unknown: 0 },
        peers: [
          { id: "p1", name: "edge-sim", baseUrl: "http://localhost:4002", apiKeyHash: null, status: "down", lastSeen: null, lastError: "connect ECONNREFUSED", lastProbedAt: null },
          { id: "p2", name: "dark-site", baseUrl: "http://localhost:4999", apiKeyHash: null, status: "down", lastSeen: null, lastError: "connect ECONNREFUSED", lastProbedAt: null },
        ],
        probeIntervalMs: 5000,
      },
    });
    const meshFinding = snap.findings.find((f) => f.id === "mesh-down")!;
    expect(meshFinding.detail).toContain("edge-sim");
    expect(meshFinding.detail).toContain("dark-site");
    // Two down peers is a CRIT (drives the −30 score, not −10).
    expect(meshFinding.severity).toBe("crit");
  });

  it("falls back to the injected mesh service when no signals are passed", async () => {
    const topology = { counts: { total: 1, up: 1, down: 0, unknown: 0 }, peers: [], probeIntervalMs: 5000 };
    const mesh = { topology: vi.fn().mockResolvedValue(topology) };
    const svc = new ControllerService(mesh as never);
    const snap = await svc.monitor({});
    expect(mesh.topology).toHaveBeenCalledOnce();
    expect(snap.findings.some((f) => f.id === "mesh-ok")).toBe(true);

    // A failing topology read degrades to 'not inspected', never throws.
    const failing = { topology: vi.fn().mockRejectedValue(new Error("db down")) };
    const svc2 = new ControllerService(failing as never);
    const snap2 = await svc2.monitor({});
    expect(snap2.findings.some((f) => f.id === "mesh-unknown")).toBe(true);
  });

  it("derives plugin degradation from the injected registry (incl. load-failed plugins)", async () => {
    const plugins = { summary: () => ({ total: 3, failed: 1, enabled: 2, disabled: 0, degradedOrDown: 1 }) };
    const svc = new ControllerService(undefined, undefined, undefined, undefined, plugins as never);
    const snap = await svc.monitor({});
    const finding = snap.findings.find((f) => f.id === "plugins-degraded")!;
    expect(finding.detail).toContain("2 plugin(s)");
  });

  it("labels the score tiers at the boundaries", async () => {
    const svc = new ControllerService();
    const at90 = await svc.monitor({ engineAvailable: true, mesh: { counts: { total: 0, up: 0, down: 0, unknown: 0 }, peers: [], probeIntervalMs: 5000 } });
    expect(at90.label).toBe("Healthy");
    // 100 − 10 (dead-letter warn) − 10 (scheduler warn) − 2 (plugin info) = 78
    const at70 = await svc.monitor({
      engineAvailable: true,
      schedulerOk: false,
      deadLetterTasks: 3,
      pluginsDegraded: 1,
      mesh: { counts: { total: 1, up: 1, down: 0, unknown: 0 }, peers: [], probeIntervalMs: 5000 },
    });
    expect(at70.score).toBe(78);
    expect(at70.label).toBe("Degraded");
    // 100 − 30 (engine crit) − 10 (dead-letter warn) − 10 (1 peer down warn) = 50
    const at40 = await svc.monitor({
      engineAvailable: false,
      deadLetterTasks: 3,
      mesh: { counts: { total: 2, up: 1, down: 1, unknown: 0 }, peers: [], probeIntervalMs: 5000 },
    });
    expect(at40.score).toBe(50);
    expect(at40.label).toBe("Unstable");
    // 100 − 30 (engine) − 30 (queue) − 10 (dead-letter) − 30 (2 peers down) = 0
    const at0 = await svc.monitor({
      engineAvailable: false,
      queueOk: false,
      deadLetterTasks: 3,
      mesh: { counts: { total: 2, up: 0, down: 2, unknown: 0 }, peers: [], probeIntervalMs: 5000 },
    });
    expect(at0.score).toBe(0);
    expect(at0.label).toBe("Critical");
  });

  it("never throws when no services are injected and runs no unsafe action", async () => {
    const svc = new ControllerService();
    const snap = await svc.monitor({});
    expect(snap.score).toBeGreaterThanOrEqual(0);
    expect(snap.findings.some((f) => f.id === "mesh-unknown")).toBe(true);

    const act = await svc.act("delete-all");
    expect(act).toEqual({ ok: false, ran: false, message: expect.stringContaining("No safe controller action") });
  });

  it("runs the whitelisted reprobe-mesh action when a mesh service is present", async () => {
    const probeAll = vi.fn().mockResolvedValue({ probed: 2, up: 2, down: 0, ran: true });
    const svc = new ControllerService({ probeAll } as never);
    const act = await svc.act("reprobe-mesh");
    expect(act.ok).toBe(true);
    expect(act.ran).toBe(true);
    expect(probeAll).toHaveBeenCalledOnce();
    expect(svc.availableActions()).toContain("reprobe-mesh");
  });

  it("re-enqueue-deadletters enqueues first, then flips the row (oldest first)", async () => {
    const failed = [
      { id: "dl1", title: "boom" },
      { id: "dl2", title: "kaboom" },
    ];
    const tasks = {
      findAllFailed: vi.fn().mockResolvedValue(failed),
      requeue: vi.fn().mockResolvedValue(true),
    };
    const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const svc = new ControllerService(undefined, tasks as never, queue as never);
    const act = await svc.act("re-enqueue-deadletters");
    expect(act.ok).toBe(true);
    expect(act.ran).toBe(true);
    expect(act.message).toContain("2 of 2");
    // Oldest-first fetch for the retry loop.
    expect(tasks.findAllFailed).toHaveBeenCalledWith(25, "asc");
    expect(tasks.requeue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    // Ordering invariant: for EACH task the job is enqueued BEFORE the row
    // flips — a failed enqueue can never leave an invisible `queued` row.
    for (const id of ["dl1", "dl2"]) {
      const enqIdx = queue.enqueue.mock.calls.findIndex((c) => c[0] === id);
      const flipIdx = tasks.requeue.mock.calls.findIndex((c) => c[0] === id);
      expect(queue.enqueue.mock.invocationCallOrder[enqIdx]).toBeLessThan(tasks.requeue.mock.invocationCallOrder[flipIdx]);
    }
  });

  it("re-enqueue-deadletters with nothing failed is an honest no-op, not a lie", async () => {
    const tasks = {
      findAllFailed: vi.fn().mockResolvedValue([]),
      requeue: vi.fn().mockResolvedValue(true),
    };
    const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const svc = new ControllerService(undefined, tasks as never, queue as never);
    const act = await svc.act("re-enqueue-deadletters");
    expect(act.ok).toBe(true);
    expect(act.ran).toBe(false);
    expect(act.message).toContain("0 of 0");
    expect(tasks.requeue).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("re-enqueue-deadletters degrades to '0 of 0' when the DLQ read fails", async () => {
    const tasks = {
      findAllFailed: vi.fn().mockRejectedValue(new Error("db down")),
      requeue: vi.fn(),
    };
    const queue = { enqueue: vi.fn() };
    const svc = new ControllerService(undefined, tasks as never, queue as never);
    const act = await svc.act("re-enqueue-deadletters");
    expect(act.ok).toBe(true);
    expect(act.ran).toBe(false);
    expect(act.message).toContain("0 of 0");
    expect(tasks.requeue).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("re-enqueue-deadletters reports a partial failure honestly (ok:false, 1 of 2)", async () => {
    const failed = [
      { id: "dl1", title: "boom" },
      { id: "dl2", title: "kaboom" },
    ];
    const tasks = {
      findAllFailed: vi.fn().mockResolvedValue(failed),
      requeue: vi.fn().mockResolvedValue(true),
    };
    // dl1's enqueue fails (Redis died post-boot) — the row must NOT flip, and
    // the loop must continue to dl2.
    const queue = {
      enqueue: vi.fn().mockImplementation((id: string) => (id === "dl1" ? Promise.reject(new Error("queue unreachable")) : Promise.resolve())),
    };
    const svc = new ControllerService(undefined, tasks as never, queue as never);
    const act = await svc.act("re-enqueue-deadletters");
    expect(act.ok).toBe(false);
    expect(act.ran).toBe(true);
    expect(act.message).toContain("1 of 2");
    expect(tasks.requeue).toHaveBeenCalledTimes(1);
    expect(tasks.requeue).toHaveBeenCalledWith("dl2");
  });

  it("re-enqueue-deadletters counts only rows the status gate actually flipped", async () => {
    const failed = [
      { id: "dl1", title: "already-completed-mid-loop" },
      { id: "dl2", title: "kaboom" },
    ];
    const tasks = {
      findAllFailed: vi.fn().mockResolvedValue(failed),
      // dl1 was completed by the worker mid-loop: the gated update returns
      // count 0 → not counted, never resurrected.
      requeue: vi.fn().mockImplementation((id: string) => Promise.resolve(id === "dl1" ? false : true)),
    };
    const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const svc = new ControllerService(undefined, tasks as never, queue as never);
    const act = await svc.act("re-enqueue-deadletters");
    expect(act.ok).toBe(false);
    expect(act.ran).toBe(true);
    expect(act.message).toContain("1 of 2");
  });

  it("re-enqueue-deadletters degrades honestly without the engine services", async () => {
    const svc = new ControllerService();
    const act = await svc.act("re-enqueue-deadletters");
    expect(act.ok).toBe(false);
    expect(act.ran).toBe(false);
    expect(act.message).toContain("not available");
  });

  it("flush-stale runs a supervisor sweep and reports its counts", async () => {
    const supervisor = {
      runSweep: vi.fn().mockResolvedValue({ ran: true, staleFound: 2, recovered: 1, failedStalled: 1, skippedActive: 0 }),
    };
    const svc = new ControllerService(undefined, undefined, undefined, supervisor as never);
    const act = await svc.act("flush-stale");
    expect(act.ok).toBe(true);
    expect(act.ran).toBe(true);
    expect(act.message).toContain("1 recovered");
    expect(supervisor.runSweep).toHaveBeenCalledOnce();
  });

  it("flush-stale reports honestly when the sweep is skipped", async () => {
    const supervisor = {
      runSweep: vi.fn().mockResolvedValue({ ran: false, staleFound: 0, recovered: 0, failedStalled: 0, skippedActive: 0 }),
    };
    const svc = new ControllerService(undefined, undefined, undefined, supervisor as never);
    const act = await svc.act("flush-stale");
    expect(act.ok).toBe(true);
    expect(act.ran).toBe(false);
    expect(act.message).toContain("skipped");
  });

  it("flush-stale degrades honestly when the sweep throws (no raw 500)", async () => {
    const supervisor = {
      runSweep: vi.fn().mockRejectedValue(new Error("redis unreachable")),
    };
    const svc = new ControllerService(undefined, undefined, undefined, supervisor as never);
    const act = await svc.act("flush-stale");
    expect(act.ok).toBe(false);
    expect(act.ran).toBe(false);
    expect(act.message).toContain("Supervisor sweep failed");
    expect(act.message).toContain("redis unreachable");
  });

  it("run-deepseek-diagnostic creates + enqueues a diagnostic task on deepseek", async () => {
    const tasks = {
      create: vi.fn().mockResolvedValue({ id: "diag1", status: "queued" }),
    };
    const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const svc = new ControllerService(undefined, tasks as never, queue as never);
    const act = await svc.act("run-deepseek-diagnostic");
    expect(act.ok).toBe(true);
    expect(act.ran).toBe(true);
    expect(act.message).toContain("diag1");
    expect(act.message).toContain("deepseek-v4-flash");
    expect(tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "AI Controller diagnostic",
        model: "deepseek-v4-flash",
        maxSteps: 3,
        prompt: expect.stringContaining("diagnostic-ok"),
      }),
      undefined,
    );
    expect(queue.enqueue).toHaveBeenCalledWith("diag1");
  });

  it("run-deepseek-diagnostic degrades honestly when task creation fails", async () => {
    const tasks = {
      create: vi.fn().mockResolvedValue(null),
    };
    const queue = { enqueue: vi.fn() };
    const svc = new ControllerService(undefined, tasks as never, queue as never);
    const act = await svc.act("run-deepseek-diagnostic");
    expect(act.ok).toBe(false);
    expect(act.ran).toBe(false);
    expect(act.message).toContain("Could not create the diagnostic task");
    expect(queue.enqueue).not.toHaveBeenCalled();

    // A rejecting create follows the same honest path.
    const tasks2 = { create: vi.fn().mockRejectedValue(new Error("db down")) };
    const svc2 = new ControllerService(undefined, tasks2 as never, queue as never);
    const act2 = await svc2.act("run-deepseek-diagnostic");
    expect(act2.ok).toBe(false);
    expect(act2.ran).toBe(false);
  });

  it("run-deepseek-diagnostic never claims success when the enqueue failed", async () => {
    const tasks = {
      create: vi.fn().mockResolvedValue({ id: "diag1", status: "queued" }),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    const queue = { enqueue: vi.fn().mockRejectedValue(new Error("queue unreachable")) };
    const svc = new ControllerService(undefined, tasks as never, queue as never);
    const act = await svc.act("run-deepseek-diagnostic");
    expect(act.ok).toBe(false);
    expect(act.ran).toBe(false);
    expect(act.message).toContain("created but could not be enqueued");
    // The orphaned `queued` row is flipped back to failed so the dead-letter
    // finding still sees it — no invisible limbo.
    expect(tasks.markFailed).toHaveBeenCalledWith("diag1", expect.stringContaining("queue unreachable"));
  });

  it("exposes the full whitelist of safe actions", async () => {
    const svc = new ControllerService();
    expect(svc.availableActions()).toEqual([
      "reprobe-mesh",
      "re-enqueue-deadletters",
      "flush-stale",
      "run-deepseek-diagnostic",
    ]);
  });
});
