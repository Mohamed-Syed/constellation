import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventBusService } from "../events/event-bus.service.js";
import { AuditService } from "../audit/audit.service.js";

export interface AlertmanagerPayload {
  alerts?: Array<{
    status?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    startsAt?: string;
    endsAt?: string;
  }>;
  groupKey?: string;
  status?: string;
}

export interface IngestedAlert {
  alertname: string;
  status: string;
  severity: string;
  instance: string;
  summary: string;
  at: string;
}

/**
 * Grafana/Prometheus ALERT-TRIGGER INGESTION (Phase 4.0 4.5 tail).
 *
 * Receives Alertmanager webhook payloads (POST /api/alerts/webhook, guarded by
 * a shared secret header) and turns each alert into an `engine.alert.fired`
 * bus event — the same core-scope topic event-triggered workflows can listen
 * on, so the AUTONOMOUS INCIDENT-RESPONSE loop is real: a firing alert spawns
 * the remediation workflow with zero human steps. Alerts are also audited.
 */
@Injectable()
export class AlertWebhookService {
  private readonly logger = new Logger(AlertWebhookService.name);
  private readonly eventBus: EventBusService | null;

  constructor(
    @Optional() private readonly audit?: AuditService,
    @Optional() bus?: EventBusService,
  ) {
    this.eventBus = bus ?? null;
  }

  /** Parse + ingest an Alertmanager payload. Returns the normalized alerts. */
  async ingest(payload: unknown): Promise<IngestedAlert[]> {
    const p = (payload ?? {}) as AlertmanagerPayload;
    const alerts = Array.isArray(p.alerts) ? p.alerts : [];
    const out: IngestedAlert[] = [];
    for (const raw of alerts) {
      const labels = raw.labels ?? {};
      const annotations = raw.annotations ?? {};
      const alert: IngestedAlert = {
        alertname: labels.alertname ?? "unknown-alert",
        status: raw.status ?? "firing",
        severity: labels.severity ?? "warning",
        instance: labels.instance ?? labels.node ?? labels.job ?? "unknown",
        summary: annotations.summary ?? annotations.description ?? "",
        at: raw.startsAt ?? new Date().toISOString(),
      };
      this.emit(alert);
      out.push(alert);
    }
    if (alerts.length > 0) {
      try {
        await this.audit?.record(null, "alert.ingested", `alerts:${alerts.length}`, {
          groupKey: p.groupKey ?? null,
        });
      } catch {
        /* audit must never break ingestion */
      }
    }
    return out;
  }

  private emit(alert: IngestedAlert): void {
    if (!this.eventBus) return;
    try {
      this.eventBus.forPlugin("core").emit("engine.alert.fired", alert);
      this.logger.log(`alert fired: ${alert.alertname} (${alert.severity}) @ ${alert.instance}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`alert emission failed: ${msg}`);
    }
  }
}
