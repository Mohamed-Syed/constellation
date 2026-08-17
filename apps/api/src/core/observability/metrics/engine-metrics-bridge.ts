import { Injectable, Logger, Optional } from "@nestjs/common";
import type { EngineAlertService } from "../../engine/engine-alerts.service.js";
import type { SchedulerEngineService } from "../../engine/scheduler-engine.service.js";
import type { SupervisorService } from "../../engine/supervisor.service.js";
import type { TaskQueueService } from "../../engine/task-queue.service.js";
import type { MetricsService } from "./metrics.service.js";

/**
 * Engine -> Prometheus bridge (Phase 2.0).
 *
 * Reads the engine's existing public health snapshots and republishes
 * queue/task depth, scheduler state, supervisor and alert totals into the
 * metrics registry. The supervisor/scheduler/alert values are cumulative
 * process-lifetime totals read from `getHealth()`, exposed as GAUGES (this is
 * correct Prometheus practice for "total X since boot" — a scrape target is
 * per-process, so the value is simply read fresh each scrape).
 *
 * This is invoked on demand by the MetricsController per scrape and swallows
 * all errors so a dead Redis/DB never breaks /metrics. The engine services are
 * injected `@Optional()`, so the bridge is safe to construct in offline tests
 * with `new MetricsEngineBridge()` and no collaborators.
 */
@Injectable()
export class MetricsEngineBridge {
  private readonly logger = new Logger(MetricsEngineBridge.name);

  constructor(
    @Optional() private readonly queue?: TaskQueueService,
    @Optional() private readonly scheduler?: SchedulerEngineService,
    @Optional() private readonly supervisor?: SupervisorService,
    @Optional() private readonly alerts?: EngineAlertService,
  ) {}

  async refresh(metrics: MetricsService): Promise<void> {
    if (!metrics.isEnabled) return;

    // Queue depths + active tasks (gauges). When the engine is disabled or the
    // read fails, emit zeros so the panel shows a truthful 0 rather than a gap.
    try {
      const h = await this.queue?.getHealth();
      metrics.recordQueueDeep(
        h && (h as { enabled?: boolean }).enabled ? safeNum((h as { waiting?: number }).waiting) : 0,
        h && (h as { enabled?: boolean }).enabled ? safeNum((h as { active?: number }).active) : 0,
        h && (h as { enabled?: boolean }).enabled ? safeNum((h as { failed?: number }).failed) : 0,
      );
    } catch {
      metrics.recordQueueDeep(0, 0, 0);
    }

    // Scheduler (gauges): due count + registered event listeners.
    try {
      const s = (await this.scheduler?.getHealth()) as
        | { enabled?: boolean; dueCount?: number; registeredEvents?: number }
        | undefined;
      metrics.setSchedulerState(safeNum(s?.dueCount), safeNum(s?.registeredEvents));
    } catch {
      metrics.setSchedulerState(0, 0);
    }

    // Supervisor cumulative totals (gauges).
    try {
      const sup = (await this.supervisor?.getHealth()) as
        | { staleFound?: number; recovered?: number; failedStalled?: number }
        | undefined;
      metrics.setSupervisorTotals(
        safeNum(sup?.staleFound),
        safeNum(sup?.recovered),
        safeNum(sup?.failedStalled),
      );
    } catch {
      metrics.setSupervisorTotals(0, 0, 0);
    }

    // Alert trail length (gauge).
    try {
      const summary = this.alerts?.getAlertSummary();
      metrics.setAlertCount(Array.isArray(summary) ? summary.length : 0);
    } catch {
      metrics.setAlertCount(0);
    }
  }
}

function safeNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
