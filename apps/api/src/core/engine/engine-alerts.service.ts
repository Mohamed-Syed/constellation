import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { EventBusService } from "../events/event-bus.service.js";
import type { FailureClassification } from "./dead-letter.js";

/** One alert recorded in the in-memory ring buffer (resets on restart). */
export interface EngineAlert {
  /** ISO timestamp of when the event occurred. */
  at: string;
  /** Semantic topic, e.g. "engine.task.failed". */
  type: string;
  /** Task id the alert refers to (when relevant). */
  taskId: string | null;
  /** Free-form detail, e.g. the error message or stale duration in ms. */
  detail: string | null;
}

/** Default cap on how many recent alerts are kept in memory. */
export const DEFAULT_ALERT_BUFFER_CAP = 50;

/**
 * Injection token for the optional ring-buffer cap. No provider is registered
 * for it in EngineModule, so Nest resolves it to `undefined` in production
 * (falling back to `DEFAULT_ALERT_BUFFER_CAP`) while offline tests pass a value
 * directly via `new EngineAlertService(bus, cap)`. `@Optional()` keeps the
 * unregistered provider from failing the container at boot (Engine v0.5).
 */
export const ENGINE_ALERTS_CAP = Symbol("ENGINE_ALERTS_CAP");

/**
 * Engine v0.5 — event-based alerting surface.
 *
 * Emits notable engine events onto the platform EventBus (scoped to the
 * "core" plugin, mirroring SchedulerEngineService) so a future notifier/tile
 * can consume `engine.task.failed` / `engine.task.stale` /
 * `engine.task.recovered` without a UI. Every emission is SAFE:
 *   - `@Optional()` — an absent EventBus never throws.
 *   - a `try/catch` around emit — a throwing handler (EventBus already guards)
 *     never crashes the caller.
 *
 * The same notable events are ALSO appended to a capped in-memory ring buffer
 * so `/api/engine/health` can surface the alert trail at runtime without any
 * consumer attached. The buffer resets on process restart.
 */
@Injectable()
export class EngineAlertService {
  private readonly logger = new Logger(EngineAlertService.name);
  private readonly cap: number;
  private readonly alerts: EngineAlert[] = [];

  constructor(
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() @Inject(ENGINE_ALERTS_CAP) cap?: number,
  ) {
    this.cap = cap ?? DEFAULT_ALERT_BUFFER_CAP;
  }

  /** The recent alert trail, newest first, capped. */
  getAlertSummary(): EngineAlert[] {
    return [...this.alerts];
  }

  /** A terminal / retry-exhausted / stalled task failure. */
  recordTaskFailed(taskId: string, classification: FailureClassification, error: string | null): void {
    this.push("engine.task.failed", taskId, error, { classification });
  }

  /** The supervisor flagged a task as stale (running too long). */
  recordTaskStale(taskId: string, staleMs: number): void {
    this.push("engine.task.stale", taskId, `${staleMs}ms`, { staleMs });
  }

  /** The supervisor successfully re-enqueued a stale task (resume attempt). */
  recordTaskRecovered(taskId: string): void {
    this.push("engine.task.recovered", taskId, null, {});
  }

  private push(type: string, taskId: string | null, detail: string | null, payload: Record<string, unknown>): void {
    const at = new Date().toISOString();
    this.alerts.unshift({ at, type, taskId, detail });
    if (this.alerts.length > this.cap) this.alerts.length = this.cap;
    this.emit(type, { taskId, detail, at, ...payload });
  }

  /** Emit onto the platform bus (scoped "core") — never throws. */
  private emit(topic: string, payload: unknown): void {
    if (!this.eventBus) return;
    try {
      this.eventBus.forPlugin("core").emit(topic, payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not emit "${topic}" to event bus: ${msg}`);
    }
  }
}
