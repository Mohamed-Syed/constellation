# Phase 2.0 — Production Foundation LIVE-PROOF evidence (Polaris, 2026-08-04)

Stack: local infra (postgres :5432, api :4001).

## 1. Prisma migrations history (Task 1) — DONE + VERIFIED
- Generated non-destructively: `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`
  against a throwaway DB. Migration `20260803200000_init` creates the `core` schema + 11 tables + all
  indexes + 4 FKs.
- Adopted on the live DB via `prisma migrate resolve --applied 20260803200000_init` (non-destructive).
- `prisma migrate status` → "1 migration found ... Database schema is up to date!" — data intact
  (2 users, 18 audit logs, 6 agent tasks).
- Fresh-DB deploy proven: `prisma migrate deploy` on throwaway `constellation_migtest` created all
  11 core tables, then the test DB was dropped.
- Files: apps/api/prisma/migrations/20260803200000_init/migration.sql, migration_lock.toml,
  scripts/prisma-migrate.sh, apps/api/prisma/README.md.

## 2. Prometheus /api/metrics (Task 2) — LIVE-PROVEN
- GET /api/metrics → HTTP 200, `Content-Type: text/plain; version=0.0.4`.
- 22 metric families exposed (counters, gauges, histograms):
  http_requests_total, http_request_duration_ms, task_lifecycle_total, task_queue_waiting,
  tasks_active, task_queue_failed, schedule_runs_total, scheduler_due, scheduler_registered_events,
  supervisor_total, supervisor_stale_found, supervisor_recovered, supervisor_failed_stalled,
  engine_alerts_total, engine_alert_trail_length, model_calls_total, model_latency_ms,
  model_tokens_total, model_cost_usd_total, plugin_tool_calls_total, auth_logins_total,
  process_uptime_seconds.
- HTTP metrics increment live: `http_requests_total{route="/api/metrics",status="200"} 3` observed.
- Engine queue snapshot gauges read live health (waiting 0, active 0).
- Zero-dep registry (hand-rolled, text exposition 0.0.4) — no prom-client.
- Tests: metrics.test.ts (registry counters/gauges/histograms/idempotence, service setters, bridge
  graceful no-op). Api suite 402 → 411.

## 3. OpenTelemetry tracing (Task 3) — NOT DONE IN THIS ROUND
- The compose stack has NO Tempo/OTLP service (confirmed by infra subagent). OTel would need a
  Tempo sidecar + a no-op-when-unconfigured tracer. Deferred — recorded as the next infra item.
  The metrics layer lands first; tracing builds on the same observability module.
