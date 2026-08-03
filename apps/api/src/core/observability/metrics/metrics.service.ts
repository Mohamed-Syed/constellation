import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MetricsRegistry } from "./registry.js";

/**
 * Central Prometheus metrics service (Phase 2.0 — "Production Foundation").
 *
 * Owns the single in-process MetricsRegistry and declares every metric the
 * platform exposes. Application code (agent worker, model router, HTTP
 * interceptor, auth) calls the small typed record methods; the metrics
 * controller calls `render()` to answer GET /api/metrics in the Prometheus
 * text exposition format.
 *
 * ADDITIVE BY DESIGN: the service needs no infrastructure (metrics are
 * process-local), so wiring it in never changes behavior. Set
 * METRICS_ENABLED=false to have render() return an empty body.
 */

export const HTTP_LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new MetricsRegistry();
  private enabled = true;

  constructor(config: ConfigService) {
    this.enabled = config.get("METRICS_ENABLED", "true") !== "false";
    this.declareAll();
    if (this.enabled) {
      this.logger.log("Prometheus metrics enabled (GET /api/metrics)");
    } else {
      this.logger.warn("Prometheus metrics disabled (METRICS_ENABLED=false)");
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Render the whole registry as a Prometheus text-exposition response body. */
  render(): string {
    if (!this.enabled) return "";
    this.registry.setGauge("constellation_process_uptime_seconds", [], Math.round(process.uptime() || 0));
    return this.registry.render();
  }

  // ---- HTTP ---------------------------------------------------------------
  recordHttpRequest(method: string, route: string, status: number, durationMs: number): void {
    if (!this.enabled) return;
    const statusClass = String(Math.floor(status / 100) * 100);
    this.registry.inc("constellation_http_requests_total", [
      ["method", method],
      ["route", route],
      ["status", statusClass],
      ["status_code", String(status)],
    ]);
    this.registry.observe("constellation_http_request_duration_ms", [["method", method], ["route", route]], durationMs);
  }

  // ---- Engine queue / scheduler / supervisor / alerts --------------------
  /** Surface the BullMQ queue snapshot (gauges). */
  recordQueueDeep(waiting: number, active: number, failed: number): void {
    if (!this.enabled) return;
    this.registry.setGauge("constellation_task_queue_waiting", [], waiting);
    this.registry.setGauge("constellation_tasks_active", [], active);
    this.registry.setGauge("constellation_task_queue_failed", [], failed);
  }

  recordTaskLifecycle(event: string): void {
    if (!this.enabled) return;
    this.registry.inc("constellation_task_lifecycle_total", [["event", event]]);
  }

  recordScheduleRun(outcome: string): void {
    if (!this.enabled) return;
    this.registry.inc("constellation_schedule_runs_total", [["outcome", outcome]]);
  }

  recordSupervisor(event: "staleFound" | "recovered" | "failedStalled"): void {
    if (!this.enabled) return;
    this.registry.inc("constellation_supervisor_total", [["event", event]]);
  }

  recordAlert(type: string): void {
    if (!this.enabled) return;
    this.registry.inc("constellation_engine_alerts_total", [["type", type]]);
  }

  /** Scheduler snapshot gauges (due schedules + registered event listeners). */
  setSchedulerState(dueCount: number, registeredEvents: number): void {
    if (!this.enabled) return;
    this.registry.setGauge("constellation_scheduler_due", [], dueCount);
    this.registry.setGauge("constellation_scheduler_registered_events", [], registeredEvents);
  }

  /** Supervisor cumulative totals (gauges read fresh per scrape). */
  setSupervisorTotals(staleFound: number, recovered: number, failedStalled: number): void {
    if (!this.enabled) return;
    this.registry.setGauge("constellation_supervisor_stale_found", [], staleFound);
    this.registry.setGauge("constellation_supervisor_recovered", [], recovered);
    this.registry.setGauge("constellation_supervisor_failed_stalled", [], failedStalled);
  }

  /** In-memory alert trail length (gauge). */
  setAlertCount(count: number): void {
    if (!this.enabled) return;
    this.registry.setGauge("constellation_engine_alert_trail_length", [], count);
  }

  // ---- Model / LLM ---------------------------------------------------------
  recordModelCall(
    provider: string,
    model: string,
    durationMs: number,
    usage?: { inputTokens?: number; outputTokens?: number; costUSD?: number },
  ): void {
    if (!this.enabled) return;
    this.registry.inc("constellation_model_calls_total", [["provider", provider], ["model", model]]);
    this.registry.observe("constellation_model_latency_ms", [["provider", provider], ["model", model]], durationMs);
    if (usage?.inputTokens) this.registry.inc("constellation_model_tokens_total", [["kind", "prompt"]], usage.inputTokens);
    if (usage?.outputTokens) this.registry.inc("constellation_model_tokens_total", [["kind", "completion"]], usage.outputTokens);
    if (usage?.costUSD) {
      this.registry.inc("constellation_model_cost_usd_total", [["provider", provider], ["model", model]], usage.costUSD);
    }
  }

  // ---- Plugins + auth ------------------------------------------------------
  recordPluginToolCall(plugin: string, tool: string, outcome: string): void {
    if (!this.enabled) return;
    this.registry.inc("constellation_plugin_tool_calls_total", [["plugin", plugin], ["tool", tool], ["outcome", outcome]]);
  }

  recordAuthLogin(method: string, outcome: string): void {
    if (!this.enabled) return;
    this.registry.inc("constellation_auth_logins_total", [["method", method], ["outcome", outcome]]);
  }

  // ---- Metric declarations -------------------------------------------------
  private declareAll(): void {
    const r = this.registry;
    r.gauge({ name: "constellation_process_uptime_seconds", help: "API process uptime in seconds.", unit: "seconds" });

    // HTTP
    r.counter({ name: "constellation_http_requests_total", help: "HTTP requests processed by method, route and status class." });
    r.histogram({ name: "constellation_http_request_duration_ms", help: "HTTP request latency in milliseconds.", unit: "milliseconds", buckets: HTTP_LATENCY_BUCKETS_MS });

    // Engine queue (gauges — snapshot depths) + task lifecycle transitions
    r.gauge({ name: "constellation_task_queue_waiting", help: "Tasks currently waiting in the BullMQ engine queue." });
    r.gauge({ name: "constellation_tasks_active", help: "Tasks currently being processed by an AgentWorker." });
    r.gauge({ name: "constellation_task_queue_failed", help: "Task jobs that failed in the BullMQ engine queue." });
    r.counter({ name: "constellation_task_lifecycle_total", help: "Task lifecycle transitions (submitted, started, completed, failed, cancelled)." });

    // Scheduler / supervisor / alerts
    r.counter({ name: "constellation_schedule_runs_total", help: "Scheduler sweep fires by outcome." });
    r.counter({ name: "constellation_supervisor_total", help: "Supervisor recovery events (staleFound, recovered, failedStalled)." });
    r.counter({ name: "constellation_engine_alerts_total", help: "Engine alerts recorded by semantic type." });
    // Snapshot gauges (read fresh per scrape)
    r.gauge({ name: "constellation_scheduler_due", help: "Schedules currently due that the scheduler has seen." });
    r.gauge({ name: "constellation_scheduler_registered_events", help: "Event listeners the scheduler has registered." });
    r.gauge({ name: "constellation_supervisor_stale_found", help: "Stale tasks the supervisor has detected since boot." });
    r.gauge({ name: "constellation_supervisor_recovered", help: "Stale tasks the supervisor recovered since boot." });
    r.gauge({ name: "constellation_supervisor_failed_stalled", help: "Stale tasks failed as stalled by the supervisor since boot." });
    r.gauge({ name: "constellation_engine_alert_trail_length", help: "Length of the in-memory engine alert trail." });

    // Model / LLM
    r.counter({ name: "constellation_model_calls_total", help: "Model provider chat calls by provider and model." });
    r.histogram({ name: "constellation_model_latency_ms", help: "Model provider call latency in milliseconds.", unit: "milliseconds", buckets: [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000] });
    r.counter({ name: "constellation_model_tokens_total", help: "Model tokens used by kind (prompt/completion)." });
    r.counter({ name: "constellation_model_cost_usd_total", help: "Accumulated model spend in USD by provider/model." });

    // Plugins + auth
    r.counter({ name: "constellation_plugin_tool_calls_total", help: "Plugin tool invocations by plugin, tool and outcome." });
    r.counter({ name: "constellation_auth_logins_total", help: "Auth login attempts by method and outcome." });
  }
}
