import {
  Injectable,
  Inject,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventBusService } from "../events/event-bus.service.js";
import { EngineAvailabilityService } from "./engine-availability.service.js";
import { engineLoopsRunHere } from "./engine-worker-role.js";
import { MetricsService } from "../observability/metrics/metrics.service.js";
import { ScheduledTaskService } from "./scheduled-task.service.js";
import { TaskQueueService } from "./task-queue.service.js";
import { TaskService } from "./task.service.js";

/** Default poll interval when SCHEDULER_POLL_INTERVAL_MS is unset. */
export const DEFAULT_POLL_INTERVAL_MS = 30_000;

export interface SchedulerEngineOptions {
  /** Injectable clock so tests can advance time without a real timer. */
  now?: () => Date;
  /** Override the poll interval (ms) without reading env (test seam). */
  pollIntervalMs?: number;
}

/**
 * Injection token for `SchedulerEngineOptions`. No provider is registered in
 * EngineModule, so Nest resolves it to `undefined` in production (falling back
 * to env + defaults) while offline tests pass a value directly via
 * `new SchedulerEngineService(...)`. `@Optional()` keeps the unregistered
 * provider from failing the container at boot.
 */
export const SCHEDULER_ENGINE_OPTIONS = Symbol("SCHEDULER_ENGINE_OPTIONS");

/** Per-fire result returned by `runSweep()` for health/logging. */
export interface SweepResult {
  /** Number of due schedules considered. */
  swept: number;
  /** Number that enqueued a task successfully. */
  fired: number;
  /** Number that errored (still recorded an honest lastError). */
  errors: number;
  /** Whether the sweep actually attempted to run (false when the engine is disabled). */
  ran: boolean;
}

/**
 * Engine v0.4 — Scheduler / Autonomous Triggers.
 *
 * Runs a lightweight poll loop that, every `SCHEDULER_POLL_INTERVAL_MS`, lists
 * ENABLED + DUE cron schedules and enqueues a task for each (reusing
 * TaskService.create + TaskQueueService.enqueue with the schedule's task
 * template). Event-triggered schedules (kind "event") are skipped by the poll
 * loop and fired instead by a registered EventBus listener when the named
 * platform event occurs.
 *
 * DEGRADATION (matching the engine's boot-with-no-infra invariant): when the
 * engine's Redis backend is down (`EngineAvailabilityService.isEnabled` false)
 * the loop logs honestly and does NOT churn — `runSweep` resolves with
 * `ran:false`, no crash, no hang. A per-schedule enqueue failure (e.g. the DB
 * dropped mid-sweep) is caught, logged, and recorded as `lastError` on the
 * schedule while `nextRunAt` advances so the loop never spins on a
 * permanently-broken schedule.
 *
 * TESTABILITY: `runSweep(now?)` and `fireSchedule(...)` are public seams that
 * need no timer or EventBus — tests call them directly with a fake clock, and
 * can inject stubbed TaskService/TaskQueueService/ScheduledTaskService via the
 * constructor. `start()`/`stop()` own the real timer + event-listener lifecycle
 * and are not exercised by the offline suite (avoiding real setInterval / real
 * EventBus).
 */
@Injectable()
export class SchedulerEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerEngineService.name);
  private readonly now: () => Date;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private sweeping = false;
  private lastSweepAt: Date | null = null;
  private dueCount = 0;
  private readonly registeredKeys = new Set<string>();

  constructor(
    private readonly scheduledTasks: ScheduledTaskService,
    private readonly tasks: TaskService,
    private readonly queue: TaskQueueService,
    private readonly availability: EngineAvailabilityService,
    @Optional() private readonly eventBus?: EventBusService,
    config?: ConfigService,
    @Optional() @Inject(SCHEDULER_ENGINE_OPTIONS) options?: SchedulerEngineOptions,
    // Phase 2.0 2.3 — schedule-run metrics feed (trailing @Optional()).
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.now = options?.now ?? (() => new Date());
    const fromEnv = Number(config?.get("SCHEDULER_POLL_INTERVAL_MS") ?? NaN);
    this.pollIntervalMs =
      options?.pollIntervalMs ??
      (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_POLL_INTERVAL_MS);
  }

  /** The configured poll interval (ms), for health/UI. */
  get pollInterval(): number {
    return this.pollIntervalMs;
  }

  async onModuleInit(): Promise<void> {
    // Phase 2.0 2.8 — separate worker mode: the poll loop runs in the
    // dedicated worker process, never in the api.
    if (!engineLoopsRunHere()) {
      this.logger.warn(`SchedulerEngineService deferred to the worker process (ENGINE_WORKER_MODE=separate)`);
      return;
    }
    await this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /**
   * Begin the timer loop and register event listeners. Idempotent. Kept
   * separate from `onModuleInit` so tests can drive `runSweep` directly
   * without any real timer.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.registerEventListeners();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    // Don't hold the process open just for the scheduler.
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as { unref: () => void }).unref();
    }
    this.logger.log(`Scheduler started (poll every ${this.pollIntervalMs}ms)`);
  }

  /** Stop the timer loop. Idempotent. */
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
        if (r.ran) this.logger.log(`Scheduler sweep: ${r.swept} due, ${r.fired} fired, ${r.errors} errors`);
      })
      .catch((err) => this.logger.error(`Scheduler sweep crashed: ${asMessage(err)}`));
  }

  /**
   * Re-register event listeners for the current event schedules. Safe and
   * idempotent — listeners are keyed by `${event}::${scheduleId}` and never
   * duplicated, so callers (the REST controller after create/enable) can call
   * this without side effects.
   */
  async refreshEventListeners(): Promise<number> {
    await this.registerEventListeners();
    return this.registeredKeys.size;
  }

  /**
   * Enumerate enabled event schedules and register one platform listener each.
   * With no EventBus injected (offline boot / tests) event schedules simply
   * never fire — the poll loop skips them and nothing crashes.
   */
  private async registerEventListeners(): Promise<void> {
    if (!this.eventBus) return;
    let all: Awaited<ReturnType<ScheduledTaskService["findAll"]>> = [];
    try {
      all = await this.scheduledTasks.findAll();
    } catch (err) {
      this.logger.warn(`Could not enumerate event schedules for listeners: ${asMessage(err)}`);
      return;
    }
    const events = this.eventBus.forPlugin("core");
    let added = 0;
    for (const sched of all) {
      if (sched.kind !== "event" || !sched.enabled) continue;
      const event = (sched.spec as { event?: string })?.event;
      if (!event) continue;
      const key = `${event}::${sched.id}`;
      if (this.registeredKeys.has(key)) continue;
      this.registeredKeys.add(key);
      added++;
      // The handler re-fetches the schedule from the DB on every fire, so a
      // schedule disabled or deleted after registration naturally stops firing
      // — no stale-capture and no need to unregister on disable/delete.
      const scheduleId = sched.id;
      events.onPlatform(event, (payload: unknown) => {
        void this.onEventFired(scheduleId, payload).catch((err) =>
          this.logger.error(`Event listener for ${key} rejected: ${asMessage(err)}`),
        );
      });
    }
    if (added > 0) this.logger.log(`Registered ${added} event listener(s)`);
  }

  /** A platform event fired for an event-triggered schedule. */
  private async onEventFired(scheduleId: string, _payload: unknown): Promise<void> {
    const sched = await this.scheduledTasks.findOne(scheduleId);
    if (!sched || !sched.enabled || sched.kind !== "event") return;
    try {
      await this.fireSchedule(sched, this.now());
    } catch (err) {
      // Event fires are logged, not thrown (the EventBus safeHandler swallows
      // rejections, but we record the error trail on the schedule too).
      await this.scheduledTasks.markRun(sched.id, this.now(), asMessage(err));
      this.emitSchedulerEvent("scheduler.schedule.error", { scheduleId, name: sched.name, error: asMessage(err) });
      this.logger.error(`Event schedule ${scheduleId} ("${sched.name}") failed: ${asMessage(err)}`);
    }
  }

  /**
   * One poll tick: list due ENABLED cron schedules and advance each one.
   * `now` is injectable so tests can advance a fake clock. Never runs two
   * sweeps concurrently (`this.sweeping` guard).
   */
  async runSweep(now: Date = this.now()): Promise<SweepResult> {
    this.lastSweepAt = now;
    if (!this.availability.isEnabled) {
      this.logger.warn(`Scheduler sweep skipped — ${this.availability.reason ?? "engine disabled"}`);
      return { swept: 0, fired: 0, errors: 0, ran: false };
    }
    if (this.sweeping) {
      this.logger.warn("Scheduler sweep already in progress — skipping overlapping tick");
      return { swept: 0, fired: 0, errors: 0, ran: false };
    }
    this.sweeping = true;
    try {
      const due = await this.scheduledTasks.listDueCronSchedules(now);
      this.dueCount = due.length;
      let fired = 0;
      let errors = 0;
      for (const sched of due) {
        try {
          await this.fireSchedule(sched, now);
          fired++;
          this.metrics?.recordScheduleRun("fired");
        } catch (err) {
          errors++;
          this.metrics?.recordScheduleRun("error");
          // Advance nextRunAt + record the honest error so we don't spin, but
          // the trail says what happened (markRun sets lastError on failure).
          await this.scheduledTasks.markRun(sched.id, now, asMessage(err));
          this.emitSchedulerEvent("scheduler.schedule.error", { scheduleId: sched.id, name: sched.name, error: asMessage(err) });
          this.logger.error(`Scheduled task ${sched.id} ("${sched.name}") failed: ${asMessage(err)}`);
        }
      }
      return { swept: due.length, fired, errors, ran: true };
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Enqueue a task for a schedule (reusing TaskService.create + this engine's
   * TaskQueueService.enqueue) and advance its run bookkeeping. Shared by the
   * cron sweep and the event listener. Throws on enqueue failure — callers
   * decide how to degrade.
   */
  async fireSchedule(
    sched: {
      id: string;
      title: string;
      prompt: string;
      model: string | null;
      maxSteps: number;
      maxTokens: number | null;
    },
    now: Date,
  ): Promise<void> {
    const task = await this.tasks.create(
      {
        title: sched.title,
        prompt: sched.prompt,
        model: sched.model ?? undefined,
        maxSteps: sched.maxSteps,
        maxTokens: sched.maxTokens ?? undefined,
      },
      undefined, // schedule-fired tasks are system-authored (no actor)
    );
    await this.queue.enqueue(task.id);
    await this.scheduledTasks.markRun(sched.id, now);
    this.emitSchedulerEvent("scheduler.schedule.fired", { scheduleId: sched.id, name: sched.title, taskId: task.id });
    this.logger.log(`Scheduled task ${sched.id} ("${sched.title}") -> task ${task.id}`);
  }

  /** Publish a scheduler event onto the platform bus ("core" scope) — never throws. */
  private emitSchedulerEvent(topic: string, payload: Record<string, unknown>): void {
    if (!this.eventBus) return;
    try {
      this.eventBus.forPlugin("core").emit(topic, payload);
    } catch (err) {
      this.logger.warn(`Could not emit "${topic}" to event bus: ${asMessage(err)}`);
    }
  }

  /** Health for /api/engine/health — scheduler status (enabled, due count, last sweep). */
  async getHealth() {
    return {
      // In separate worker mode the api honestly reports the loop as off.
      enabled: this.availability.isEnabled && engineLoopsRunHere(),
      pollIntervalMs: this.pollIntervalMs,
      lastSweepAt: this.lastSweepAt?.toISOString() ?? null,
      dueCount: this.dueCount,
      registeredEvents: this.registeredKeys.size,
    };
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
