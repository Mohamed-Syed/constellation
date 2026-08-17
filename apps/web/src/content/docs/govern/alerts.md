# Alerts & incident response

> Prometheus/Alertmanager alerts become first-class platform events, and event-triggered workflows turn them into autonomous remediation.

## Ingesting alerts

`POST /api/alerts/webhook` accepts an Alertmanager payload (public endpoint, guarded by a shared secret):

| Header | Value |
|---|---|
| `X-Webhook-Secret` | Must equal `ALERT_WEBHOOK_SECRET` (unset = dev-accept, documented) |

Each alert is normalized and published as an **`engine.alert.fired`** event (core scope) + audit row. Empty payloads → `[]`; bus failures never break ingestion; wrong secret → **401**.

## What happens next

1. The alert event is emitted.
2. **Event-triggered workflows** armed on `engine.alert.fired` run automatically — e.g. an *alert-remediation* workflow that investigates the alert with an agent.
3. The event also lands in the notification feed (`engine.alert.fired`).

## Setting it up end to end

1. Configure Alertmanager to POST to `http://<constellation>/api/alerts/webhook` with `X-Webhook-Secret`.
2. Create a workflow triggered by `engine.alert.fired` (see **Workflows**).
3. Send a test alert (or use the channel **Test** where available) and watch the workflow run.

> **Proven live:** a real Alertmanager payload (HighCPU critical + DiskFull warning) ran an armed remediation workflow to completion; a wrong secret got a 401.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ALERT_WEBHOOK_SECRET` | *(unset = dev-accept)* | Shared secret for the webhook |
