import { Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { asMessage } from "../engine/error-utils.js";
import { SchedulerEngineService } from "../engine/scheduler-engine.service.js";
import { SupervisorService } from "../engine/supervisor.service.js";
import { TaskQueueService } from "../engine/task-queue.service.js";
import { TaskService } from "../engine/task.service.js";
import { MeshService } from "../mesh/mesh.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { PluginRegistryService } from "../plugins/plugin-registry.service.js";
import { ControllerService, type ControllerSignals, type ControllerSnapshot } from "./controller.service.js";

/** Live state of the autonomous watch loop, surfaced on the status snapshot. */
export interface ControllerWatchStatus {
  enabled: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  lastScore: number | null;
  lastLabel: string | null;
  lastAction: string | null;
  lastActionAt: string | null;
}

/**
 * Phase 5.0 — HEAL slice: the AUTONOMOUS watch loop.
 *
 * The MONITOR slice (ControllerService) can score the platform and list safe
 * actions; the portal can run them by hand. This service closes the loop the
 * way the operator asked — "watch how it is doing, start": on a fixed cadence
 * it gathers the same live signals as GET /status, runs the monitor, and
 * WITHOUT a human in the loop executes the recommended actions that are on
 * the autonomous whitelist (safe, idempotent, ~zero-cost recovery moves:
 * reprobe-mesh, re-enqueue-deadletters, flush-stale). The diagnostic action
 * is deliberately NOT autonomous (it spends model budget).
 *
 * Guardrails (the autonomous tier must never make things worse):
 *   - per-action cooldown: the same action never runs more often than its
 *     cooldown window (re-enqueue at most every 15 min), so a task that keeps
 *     re-failing cannot be churned into a loop;
 *   - overlap guard: ticks never run concurrently;
 *   - every autonomous action is audited as an `ai-controller.autonomous`
 *     notification with the exact message + action name;
 *   - score/label transitions are watched and notified (the "watch" part):
 *     the operator is told when the platform degrades and when it recovers;
 *   - with no services wired (or a DB-less boot) the tick degrades to an
 *     honest monitor snapshot and never throws.
 *
 * TESTABILITY: `tick(now?)` is a public seam (no timer needed); `onModuleInit`
 * owns the interval. Env: CONTROLLER_WATCH_ENABLED (default on),
 * CONTROLLER_WATCH_INTERVAL_MS (default 30000).
 */
@Injectable()
export class ControllerWatchService implements OnModuleInit {
  private readonly logger = new Logger(ControllerWatchService.name);

  /** Recommended actions that may run autonomously (safe + idempotent + ~$0). */
  private static readonly AUTONOMOUS_ACTIONS = new Set(["reprobe-mesh", "re-enqueue-deadletters", "flush-stale"]);

  /** Minimum gap between autonomous runs of the same action, in ms. */
  private static readonly ACTION_COOLDOWN_MS: Record<string, number> = {
    "reprobe-mesh": 60_000,
    "re-enqueue-deadletters": 900_000, // 15 min — a re-failing task must not churn
    "flush-stale": 300_000,
  };

  private readonly intervalMs = Math.max(5000, Number(process.env.CONTROLLER_WATCH_INTERVAL_MS ?? 30_000) || 30_000);
  private timer?: NodeJS.Timeout;
  private tickInProgress = false;

  private lastTickAt: string | null = null;
  private lastScore: number | null = null;
  private lastLabel: string | null = null;
  private lastAction: string | null = null;
  private lastActionAt: string | null = null;
  private readonly lastActionRun = new Map<string, number>();

  constructor(
    private readonly controller: ControllerService,
    @Optional() private readonly mesh?: MeshService,
    @Optional() private readonly tasks?: TaskService,
    @Optional() private readonly queue?: TaskQueueService,
    @Optional() private readonly scheduler?: SchedulerEngineService,
    @Optional() private readonly supervisor?: SupervisorService,
    @Optional() private readonly plugins?: PluginRegistryService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  get enabled(): boolean {
    return (process.env.CONTROLLER_WATCH_ENABLED ?? "on") !== "off";
  }

  status(): ControllerWatchStatus {
    return {
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      lastTickAt: this.lastTickAt,
      lastScore: this.lastScore,
      lastLabel: this.lastLabel,
      lastAction: this.lastAction,
      lastActionAt: this.lastActionAt,
    };
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log("Autonomous AI Controller watch is OFF (CONTROLLER_WATCH_ENABLED=off).");
      return;
    }
    this.logger.log(`Autonomous AI Controller watch started — tick every ${this.intervalMs}ms.`);
    // First tick shortly after boot (let the platform settle), then the cadence.
    const firstDelay = Math.min(this.intervalMs, 10_000);
    setTimeout(() => void this.tick(), firstDelay);
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One watch tick: gather live signals → monitor → watch score transitions →
   * run any due autonomous recovery actions. `now` is injectable for tests.
   * Never throws; never overlaps with a running tick.
   */
  async tick(now: number = Date.now()): Promise<ControllerSnapshot | null> {
    if (this.tickInProgress) return null;
    this.tickInProgress = true;
    try {
      const snapshot = await this.controller.monitor(await this.gatherSignals());
      this.lastTickAt = new Date().toISOString();
      // Capture the PREVIOUS label before updating — watchScore must compare
      // against what the last tick actually reported, not the new one.
      const previousLabel = this.lastLabel;
      this.lastScore = snapshot.score;
      this.lastLabel = snapshot.label;
      await this.watchScore(snapshot, previousLabel);
      await this.heal(snapshot, now);
      return snapshot;
    } catch (err) {
      // The monitor is designed not to throw; if it ever does, the watch must
      // survive the tick and retry on the next cadence.
      this.logger.error(`AI Controller watch tick failed: ${asMessage(err)}`);
      return null;
    } finally {
      this.tickInProgress = false;
    }
  }

  /** Collect the same live signals as GET /api/ai-controller/status. */
  private async gatherSignals(): Promise<ControllerSignals> {
    const [mesh, sched, sup, queue, deadLetters, pluginSummary] = await Promise.all([
      this.mesh?.topology().catch(() => null),
      this.scheduler?.getHealth().catch(() => null),
      this.supervisor?.getHealth().catch(() => null),
      this.queue?.getHealth().catch(() => null),
      this.tasks?.getFailedCount().catch(() => 0),
      Promise.resolve(this.plugins ? this.plugins.summary() : { degradedOrDown: 0, failed: 0 }),
    ]);
    return {
      engineAvailable: true, // the api itself is up (it's serving this tick)
      queueOk: queue?.enabled ?? undefined,
      schedulerOk: sched?.enabled ?? undefined,
      supervisorOk: sup?.enabled ?? undefined,
      mesh,
      deadLetterTasks: deadLetters,
      pluginsDegraded: pluginSummary.degradedOrDown + pluginSummary.failed,
    };
  }

  /** Notify the operator on score/label transitions (degradation AND recovery). */
  private async watchScore(snapshot: ControllerSnapshot, previousLabel: string | null): Promise<void> {
    const notifications = this.notifications;
    if (!notifications || previousLabel === null || previousLabel === snapshot.label) return;
    const direction = this.severityRank(snapshot.label) > this.severityRank(previousLabel) ? "degraded" : "recovered";
    const topIssues = snapshot.findings
      .filter((f) => f.severity !== "ok")
      .slice(0, 3)
      .map((f) => f.title)
      .join("; ");
    const message =
      direction === "degraded"
        ? `Platform status changed ${previousLabel} → ${snapshot.label} (score ${snapshot.score}). Issues: ${topIssues || "none listed"}.`
        : `Platform status recovered to ${snapshot.label} (score ${snapshot.score}).`;
    try {
      await notifications.record("ai-controller.watch", "info", "AI Controller watch", message, "ai-controller", direction);
    } catch (err) {
      this.logger.warn(`Watch transition notification failed: ${asMessage(err)}`);
    }
  }

  /** Run due autonomous recovery actions for the current findings. */
  private async heal(snapshot: ControllerSnapshot, now: number): Promise<void> {
    for (const action of snapshot.actionsRecommended) {
      if (!ControllerWatchService.AUTONOMOUS_ACTIONS.has(action)) continue;
      const lastRun = this.lastActionRun.get(action) ?? 0;
      const cooldown = ControllerWatchService.ACTION_COOLDOWN_MS[action] ?? 60_000;
      if (now - lastRun < cooldown) continue;
      this.lastActionRun.set(action, now);
      let result;
      try {
        result = await this.controller.act(action);
      } catch (err) {
        this.logger.warn(`Autonomous action ${action} failed: ${asMessage(err)}`);
        continue;
      }
      if (!result.ran) continue;
      this.lastAction = action;
      this.lastActionAt = new Date().toISOString();
      this.logger.log(`AI Controller acted autonomously: ${action} — ${result.message}`);
      try {
        await this.notifications?.record("ai-controller.autonomous", "info", "AI Controller acted autonomously", result.message, "ai-controller", action);
      } catch (err) {
        this.logger.warn(`Autonomous action audit failed: ${asMessage(err)}`);
      }
    }
  }

  private severityRank(label: string): number {
    return label === "Healthy" ? 0 : label === "Degraded" ? 1 : label === "Unstable" ? 2 : 3;
  }
}
