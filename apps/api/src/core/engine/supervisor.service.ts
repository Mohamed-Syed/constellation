import {
  Injectable,
  Inject,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EngineAlertService } from "./engine-alerts.service.js";
import { EngineAvailabilityService } from "./engine-availability.service.js";
import { engineLoopsRunHere } from "./engine-worker-role.js";
import { MetricsService } from "../observability/metrics/metrics.service.js";
import { TaskQueueService } from "./task-queue.service.js";
import { TaskService } from "./task.service.js";

/** Default supervisor poll interval (ms) when ENGINE_SUPERVISOR_INTERVAL_MS is unset. */
export const DEFAULT_SUPERVISOR_INTERVAL_MS = 30_000;

/** Default stale threshold (ms) before a `running` task is considered stuck. */
export const DEFAULT_STALE_TASK_MS = 300_000; // 5 minutes

export interface SupervisorOptions {
  /** Injectable clock so tests can advance time without a real timer. */
  now?: () => Date;
  /** Override the poll interval (ms) without reading env (test seam). */
  pollIntervalMs?: number;
  /** Override the stale threshold (ms) without reading env (test seam). */
  staleTaskMs?: number;
}

/** Injection token for `SupervisorOptions`. Unregistered in EngineModule, so Nest resolves it to undefined in production; offline tests pass a value via `new`. */
export const SUPERVISOR_OPTIONS = Symbol("SUPERVISOR_OPTIONS");

/** Result of one supervision sweep, for health/logging. */
export interface SupervisionResult {
  /** Whether the sweep actually attempted recovery (false when the engine is disabled). */
  ran: boolean;
  /** Number of stale running tasks found. */
  staleFound: number;
  /** Number of genuinely-stalled tasks re-enqueued (resume attempt). */
  recovered: number;
  /** Number already-resumed-once tasks marked failed (`stalled`). */
  failedStalled: number;
  /** taskIds skipped because an ACTIVE BullMQ job was demonstrably working them. */
  skippedActive: number;
}

/**
 * Engine v0.5 — Supervisor / stuck-task detection.
 *
 * Polls every `ENGINE_SUPERVISOR_INTERVAL_MS` for tasks stuck in `running`
 * whose `updatedAt` is older than `ENGINE_STALE_TASK_MS` (no step progress for
 * too long — an orphaned job after a crash, or a worker stall). For each stale
 * task it:
 *
 *  1. SAFETY RACE GUARD — verifies the task is NOT actually being worked right
 *     now (via `TaskQueueService.getActiveTaskIds()`). If an ACTIVE BullMQ job
 *     for this task exists, the worker is alive on it → the supervisor MUST
 *     not act (no double-run). It skips the task.
 *
 *  2. RESUME-ONCE — if the task has NOT already been resumed once, re-enqueue
 *     it (BullMQ resume), set the `stallRetried` marker, and emit a
 *     `recovered` alert. Nothing spins forever.
 *
 *  3. STALL → FAIL — if the task has already been resumed once and is stale
 *     AGAIN, mark it `failed` with a `stalled` classification and an honest
 *     error, and emit a `task.failed` alert.
 *
 * DEGRADATION (matching the engine's boot-with-no-infra invariant): when the
 * engine's Redis backend is down, `runSweep` resolves with `ran:false` — no
 * churn, no crash. When there is no DB, `findStaleRunning` returns [] and the
 * sweep is a no-op.
 *
 * TESTABILITY: `runSweep(now?)` is a public seam needing no timer; `start()`/
 * `stop()` own the real setInterval + unref and are not exercised offline.
 */
@Injectable()
export class SupervisorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupervisorService.name);
  private readonly now: () => Date;
  private readonly pollIntervalMs: number;
  private readonly staleTaskMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private sweeping = false;
  private lastSweepAt: Date | null = null;
  private staleFoundTotal = 0;
  private recoveredTotal = 0;
  private failedStalledTotal = 0;

  constructor(
    private readonly tasks: TaskService,
    private readonly queue: TaskQueueService,
    private readonly availability: EngineAvailabilityService,
    private readonly alerts: EngineAlertService,
    config?: ConfigService,
    @Optional() @Inject(SUPERVISOR_OPTIONS) options?: SupervisorOptions,
    // Phase 2.0 2.3 — supervisor metrics feed (trailing @Optional()).
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.now = options?.now ?? (() => new Date());
    const fromEnv = Number(config?.get("ENGINE_SUPERVISOR_INTERVAL_MS") ?? NaN);
    this.pollIntervalMs =
      options?.pollIntervalMs ??
      (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_SUPERVISOR_INTERVAL_MS);
    const staleEnv = Number(config?.get("ENGINE_STALE_TASK_MS") ?? NaN);
    this.staleTaskMs =
      options?.staleTaskMs ??
      (Number.isFinite(staleEnv) && staleEnv > 0 ? staleEnv : DEFAULT_STALE_TASK_MS);
  }

  /** The configured poll interval (ms), for health/UI. */
  get pollInterval(): number {
    return this.pollIntervalMs;
  }

  /** The stale threshold (ms), for health/UI. */
  get staleThresholdMs(): number {
    return this.staleTaskMs;
  }

  async onModuleInit(): Promise<void> {
    // Phase 2.0 2.8 — separate worker mode: the sweep loop runs in the
    // dedicated worker process, never in the api.
    if (!engineLoopsRunHere()) {
      this.logger.warn(`SupervisorService deferred to the worker process (ENGINE_WORKER_MODE=separate)`);
      return;
    }
    await this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    // Don't hold the process open just for the supervisor.
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as { unref: () => void }).unref();
    }
    this.logger.log(`Supervisor started (poll every ${this.pollIntervalMs}ms, stale after ${this.staleTaskMs}ms)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
  }

  private tick(): void {
    void this.runSweep(this.now())
      .then((r) => {
        if (r.ran) {
          this.logger.log(
            `Supervisor sweep: ${r.staleFound} stale, ${r.recovered} recovered, ${r.failedStalled} failed (${r.skippedActive} active-skipped)`,
          );
        }
      })
      .catch((err) => this.logger.error(`Supervisor sweep crashed: ${asMessage(err)}`));
  }

  /**
   * One supervision tick. `now` is injectable so tests can advance a fake
   * clock. Never runs two sweeps concurrently (`this.sweeping` guard).
   */
  async runSweep(now: Date = this.now()): Promise<SupervisionResult> {
    this.lastSweepAt = now;
    if (!this.availability.isEnabled) {
      this.logger.warn(`Supervisor sweep skipped — ${this.availability.reason ?? "engine disabled"}`);
      return { ran: false, staleFound: 0, recovered: 0, failedStalled: 0, skippedActive: 0 };
    }
    if (this.sweeping) {
      this.logger.warn("Supervisor sweep already in progress — skipping overlapping tick");
      return { ran: false, staleFound: 0, recovered: 0, failedStalled: 0, skippedActive: 0 };
    }
    this.sweeping = true;
    try {
      const staleBefore = new Date(now.getTime() - this.staleTaskMs);
      const stale = await this.tasks.findStaleRunning(staleBefore);
      this.staleFoundTotal += stale.length;
      for (let i = 0; i < stale.length; i++) this.metrics?.recordSupervisor("staleFound");

      // Race guard: snapshot the live working set ONCE per sweep.
      const activeTaskIds = await this.queue.getActiveTaskIds();

      let recovered = 0;
      let failedStalled = 0;
      let skippedActive = 0;
      for (const task of stale) {
        if (activeTaskIds.has(task.id)) {
          // A live worker is on this task — never act on it (no double-run).
          skippedActive++;
          continue;
        }
        if (task.stallRetried) {
          // Already resumed once and stale again → honest stalled dead letter.
          const staleSeconds = Math.max(0, Math.round((now.getTime() - task.updatedAt.getTime()) / 1000));
          const error = `stalled after resume attempt — no progress for ${staleSeconds}s${task.error ? `; last error: ${task.error}` : ""}`;
          await this.tasks.markFailed(task.id, error, "stalled");
          this.alerts.recordTaskFailed(task.id, "stalled", error);
          this.failedStalledTotal++;
          failedStalled++;
          this.metrics?.recordSupervisor("failedStalled");
          this.logger.error(`Task ${task.id} marked failed (stalled) — ${error}`);
        } else {
          // Resume attempt (BullMQ re-enqueue). Mark queued + resume-once flag,
          // so a second stale occurrence is NOT re-enqueued again.
          await this.tasks.markResumed(task.id);
          await this.tasks.markStallRetried(task.id);
          await this.queue.enqueue(task.id);
          this.alerts.recordTaskStale(task.id, now.getTime() - task.updatedAt.getTime());
          this.alerts.recordTaskRecovered(task.id);
          this.recoveredTotal++;
          recovered++;
          this.metrics?.recordSupervisor("recovered");
          this.logger.warn(`Task ${task.id} re-enqueued by supervisor (stale, resume attempt #1)`);
        }
      }
      return { ran: true, staleFound: stale.length, recovered, failedStalled, skippedActive };
    } finally {
      this.sweeping = false;
    }
  }

  /** Health for /api/engine/health — supervision status (enabled, last sweep, counters). */
  async getHealth() {
    return {
      // In separate worker mode the api honestly reports the sweep as off.
      enabled: this.availability.isEnabled && engineLoopsRunHere(),
      pollIntervalMs: this.pollIntervalMs,
      staleThresholdMs: this.staleTaskMs,
      lastSweepAt: this.lastSweepAt?.toISOString() ?? null,
      staleFound: this.staleFoundTotal,
      recovered: this.recoveredTotal,
      failedStalled: this.failedStalledTotal,
    };
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
