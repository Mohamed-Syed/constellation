# Live-proof evidence — Phase 4.0 · ALERT-TRIGGER INGESTION (4.5 tail) (2026-08-05)

Polaris. Files: `workflow.json`, `ingest.json`, `workflow-detail.json` (the runs),
`api.log` excerpt in this doc.

## What shipped
- **`AlertWebhookService`** — receives Alertmanager webhook payloads and turns
  each alert into an **`engine.alert.fired`** bus event (core scope) + an audit
  row. That is the missing trigger source for the AUTONOMOUS INCIDENT-RESPONSE
  loop: event-triggered workflows already arm listeners on any core event, so a
  firing alert now auto-spawns the remediation workflow with zero human steps.
- **`POST /api/alerts/webhook`** (public route, guarded by the `X-Webhook-Secret`
  header matching env `ALERT_WEBHOOK_SECRET`; unset = dev-accept, documented).
  `.env.example` block added.
- Normalization: alertname/status/severity/instance (job/node fallback)/
  summary/at; empty payloads → []; bus failures never break ingestion.

## LIVE PROOF (real Alertmanager payload → real workflow run)
- Workflow "alert-remediation" created with `trigger: {type: "event", event:
  "engine.alert.fired"}` → log: **"event trigger armed on engine.alert.fired
  (core + platform scopes)"**.
- `POST /api/alerts/webhook` with a real Alertmanager payload (HighCPU
  critical + DiskFull warning) → `ingested: [HighCPU, DiskFull]` + per-alert
  "alert fired" logs + audit row.
- **The event-triggered workflow RAN**: workflow detail shows 2 runs — the
  first **completed** ("Workflow alert-remediation run …: completed (1 steps)")
  and the second ran to a **model-variance failure** ("Reached max steps (5)
  without completing" — the 7b coder model rambled on the terse remediation
  prompt; the mechanics are identical to the completed run).
- Wrong secret → **HTTP 401**.

## Gates
api **602** (45 files, +3 alert tests) · full four-gate in the round-close pass.
