import json

DS = {"type": "prometheus", "uid": "prometheus"}


def stat(title, expr, unit="short", decimals=0, legend=None):
    return {
        "id": None, "type": "stat", "title": title, "datasource": DS,
        "gridPos": {}, "targets": [{"expr": expr, "refId": "A", "legendFormat": legend or "{{__name__}}"}],
        "fieldConfig": {"defaults": {"unit": unit, "decimals": decimals, "color": {"mode": "palette-classic"}}, "overrides": []},
        "options": {"colorMode": "value", "graphMode": "area", "justifyMode": "auto", "orientation": "auto", "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}},
    }


def ts(title, expr, legend, unit="short"):
    return {
        "id": None, "type": "timeseries", "title": title, "datasource": DS,
        "gridPos": {},
        "targets": [{"expr": expr, "refId": "A", "legendFormat": legend}],
        "fieldConfig": {"defaults": {"unit": unit, "custom": {"drawStyle": "line", "lineInterpolation": "smooth", "fillOpacity": 12, "stacking": {"mode": "normal"}, "lineWidth": 2}, "color": {"mode": "palette-classic"}}, "overrides": []},
        "options": {"legend": {"displayMode": "list", "placement": "bottom", "showLegend": True}, "tooltip": {"mode": "multi", "sort": "desc"}},
    }


def p95(expr, unit="ms"):
    return ts("HTTP latency p95", f"histogram_quantile(0.95, sum(rate({expr}[5m])) by (le))", "p95", unit=unit)


panels = []


def add(p, x, y, w, h):
    p["gridPos"] = {"x": x, "y": y, "h": h, "w": w}
    p["id"] = len(panels) + 1
    panels.append(p)


# Row 0 — Engine overview
add(stat("Queue waiting", "constellation_task_queue_waiting"), 0, 0, 4, 4)
add(stat("Queue active", "constellation_tasks_active"), 4, 0, 4, 4)
add(stat("Queue failed", "constellation_task_queue_failed"), 8, 0, 4, 4)
add(stat("Uptime (s)", "constellation_process_uptime_seconds"), 12, 0, 4, 4)
add(stat("Alert trail length", "constellation_engine_alert_trail_length"), 16, 0, 4, 4)
add(ts("Task lifecycle rate", "sum(rate(constellation_task_lifecycle_total[5m])) by (event)", "{{event}}"), 0, 4, 12, 6)
add(ts("Engine alerts rate", "sum(rate(constellation_engine_alerts_total[5m])) by (type)", "{{type}}"), 12, 4, 12, 6)

# Row 1 — Model plane
add(ts("Model calls by provider", "sum(rate(constellation_model_calls_total[5m])) by (provider)", "{{provider}}"), 0, 10, 8, 6)
add(ts("Tokens by kind", "sum(rate(constellation_model_tokens_total[5m])) by (kind)", "{{kind}}"), 8, 10, 8, 6)
add(ts("Model spend (USD)", "sum(increase(constellation_model_cost_usd_total[5m])) by (provider)", "{{provider}}", unit="currencyUSD"), 16, 10, 8, 6)
add(ts("Model latency p95", "histogram_quantile(0.95, sum(rate(constellation_model_latency_ms_bucket[5m])) by (le))", "p95", unit="ms"), 0, 16, 12, 6)

# Row 2 — Plugins & HTTP
add(ts("Plugin tool calls", "sum(rate(constellation_plugin_tool_calls_total[5m])) by (plugin, outcome)", "{{plugin}}/{{outcome}}"), 0, 22, 12, 6)
add(ts("HTTP requests by status", "sum(rate(constellation_http_requests_total[5m])) by (status)", "{{status}}"), 12, 22, 12, 6)
add(p95("constellation_http_request_duration_ms"), 0, 28, 12, 6)
add(ts("Auth logins", "sum(rate(constellation_auth_logins_total[5m])) by (outcome)", "{{outcome}}"), 12, 28, 12, 6)

# Row 3 — Scheduler & supervision
add(ts("Schedule runs by outcome", "sum(rate(constellation_schedule_runs_total[5m])) by (outcome)", "{{outcome}}"), 0, 34, 8, 6)
add(stat("Scheduler due", "constellation_scheduler_due"), 8, 34, 4, 6)
add(stat("Scheduler event listeners", "constellation_scheduler_registered_events"), 12, 34, 4, 6)
add(ts("Supervisor events", "sum(rate(constellation_supervisor_total[5m])) by (event)", "{{event}}"), 16, 34, 8, 6)

dash = {
    "uid": "constellation",
    "title": "Constellation Platform",
    "description": "Pre-built dashboard (Phase 2.0 2.3) over the api's /api/metrics Prometheus metrics: engine queue + task lifecycle, model plane (calls/tokens/cost/latency), plugin tool calls, HTTP latency/status, auth, scheduler + supervision.",
    "tags": ["constellation", "platform"],
    "timezone": "utc",
    "schemaVersion": 39,
    "version": 1,
    "refresh": "15s",
    "time": {"from": "now-30m", "to": "now"},
    "panels": panels,
    "templating": {"list": []},
    "annotations": {"list": []},
}

out = "infra/grafana/provisioning/dashboards/constellation.json"
with open(out, "w") as f:
    json.dump(dash, f, indent=2)
print(f"wrote {out}: {len(panels)} panels")
