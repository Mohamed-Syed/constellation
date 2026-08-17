import { beforeEach, describe, expect, it } from "vitest";
import { ConfigService } from "@nestjs/config";
import { MetricsRegistry } from "./registry.js";
import { MetricsService } from "./metrics.service.js";
import { MetricsEngineBridge } from "./engine-metrics-bridge.js";

describe("MetricsRegistry", () => {
  let r: MetricsRegistry;
  beforeEach(() => {
    r = new MetricsRegistry();
  });

  it("increments a counter and renders exposition format 0.0.4", () => {
    r.counter({ name: "my_counter", help: "a counter" });
    r.inc("my_counter", [["kind", "a"]]);
    r.inc("my_counter", [["kind", "a"]], 2);
    const out = r.render();
    expect(out).toContain("# HELP my_counter a counter");
    expect(out).toContain("# TYPE my_counter counter");
    expect(out).toContain('my_counter{kind="a"} 3');
  });

  it("declares are idempotent and unknown ops are no-ops", () => {
    r.counter({ name: "c", help: "original help" });
    r.counter({ name: "c", help: "redeclared help" });
    r.inc("c", []);
    expect(r.inc("does_not_exist", [])).toBeUndefined();
    const out = r.render();
    // Idempotent: first declaration wins, no duplicate HELP lines.
    expect(out.match(/# HELP c original help/g)).toHaveLength(1);
    expect(out).not.toContain("redeclared help");
    expect(out).toContain("c 1");
  });

  it("gauges set absolute values and can be overwritten", () => {
    r.gauge({ name: "g", help: "a gauge" });
    r.setGauge("g", [], 5);
    r.setGauge("g", [], 2);
    expect(r.render()).toContain("g 2");
  });

  it("histograms produce cumulative buckets, +Inf, sum and count", () => {
    r.histogram({ name: "latency", help: "lat ms", unit: "milliseconds", buckets: [10, 100] });
    r.observe("latency", [], 5);
    r.observe("latency", [], 200);
    const out = r.render();
    expect(out).toContain("# TYPE latency histogram");
    expect(out).toContain('latency_milliseconds_bucket{le="10"} 1');
    expect(out).toContain('latency_milliseconds_bucket{le="100"} 2');
    expect(out).toContain('latency_milliseconds_bucket{le="+Inf"} 2');
    expect(out).toContain("latency_milliseconds_sum 205");
    expect(out).toContain("latency_milliseconds_count 2");
  });
});

describe("MetricsService", () => {
  let svc: MetricsService;
  beforeEach(() => {
    // Enabled path; METRICS_ENABLED undefined -> default true.
    svc = new MetricsService({ get: (k: string, d?: string) => (k === "METRICS_ENABLED" ? d ?? "true" : undefined) } as unknown as ConfigService);
  });

  it("declares all platform metrics and renders them", () => {
    svc.recordHttpRequest("GET", "/api/engine/tasks", 200, 12);
    svc.recordTaskLifecycle("completed");
    svc.recordScheduleRun("ok");
    svc.recordSupervisor("recovered");
    svc.recordAlert("engine.task.failed");
    svc.recordModelCall("ollama", "qwen2.5-coder:7b", 500, { inputTokens: 100, outputTokens: 50, costUSD: 0 });
    svc.recordPluginToolCall("browser-use", "navigate", "ok");
    svc.recordAuthLogin("password", "success");
    const out = svc.render();
    expect(out).toContain("constellation_http_requests_total");
    expect(out).toContain("constellation_task_lifecycle_total");
    expect(out).toContain("constellation_schedule_runs_total");
    expect(out).toContain("constellation_supervisor_total");
    expect(out).toContain("constellation_engine_alerts_total");
    expect(out).toContain("constellation_model_calls_total");
    expect(out).toContain('constellation_model_tokens_total{kind="prompt"} 100');
    expect(out).toContain("constellation_plugin_tool_calls_total");
    expect(out).toContain("constellation_auth_logins_total");
  });

  it("honours METRICS_ENABLED=false and renders empty", () => {
    const disabled = new MetricsService({ get: () => "false" } as unknown as ConfigService);
    expect(disabled.isEnabled).toBe(false);
    disabled.recordHttpRequest("GET", "/x", 200, 1);
    expect(disabled.render()).toBe("");
  });

  it("sets snapshot gauges via the scheduler/supervisor/alert setters", () => {
    svc.setSchedulerState(3, 2);
    svc.setSupervisorTotals(4, 1, 1);
    svc.setAlertCount(5);
    const out = svc.render();
    expect(out).toContain("constellation_scheduler_due 3");
    expect(out).toContain("constellation_supervisor_stale_found 4");
    expect(out).toContain("constellation_engine_alert_trail_length 5");
  });
});

describe("MetricsEngineBridge", () => {
  it("is constructible with no collaborators and no-ops on missing engine", async () => {
    const bridge = new MetricsEngineBridge();
    const svc = new MetricsService({ get: () => "true" } as unknown as ConfigService);
    await expect(bridge.refresh(svc)).resolves.toBeUndefined();
    expect(svc.render()).toContain("constellation_task_queue_waiting 0");
  });

  it("reads engine health into gauges from partial collaborator stubs", async () => {
    const queue = { getHealth: async () => ({ enabled: true, waiting: 2, active: 1, failed: 0 }) };
    const scheduler = { getHealth: async () => ({ dueCount: 4, registeredEvents: 1 }) };
    const supervisor = { getHealth: async () => ({ staleFound: 7, recovered: 2, failedStalled: 1 }) };
    const alerts = { getAlertSummary: () => [{ at: "x", type: "engine.task.failed", taskId: "t1", detail: null }] };
    const bridge = new MetricsEngineBridge(
      queue as never,
      scheduler as never,
      supervisor as never,
      alerts as never,
    );
    const svc = new MetricsService({ get: () => "true" } as unknown as ConfigService);
    await bridge.refresh(svc);
    const out = svc.render();
    expect(out).toContain("constellation_task_queue_waiting 2");
    expect(out).toContain("constellation_tasks_active 1");
    expect(out).toContain("constellation_scheduler_due 4");
    expect(out).toContain("constellation_supervisor_stale_found 7");
    expect(out).toContain("constellation_engine_alert_trail_length 1");
  });
});
