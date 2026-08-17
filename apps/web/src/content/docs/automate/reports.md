# Scheduled reports & compliance delivery

> Generate compliance/audit reports as PDFs on demand or on a schedule, and deliver them to a specific user through the notification channels.

## Generating a report

1. Open the **Notifications** page → **Audit** tab.
2. Click **Export CSV** for a CSV download — or use the API for a full PDF report:

| Endpoint | Purpose |
|---|---|
| `GET /api/audit/export?format=csv` | RFC-4180 CSV of the audit log (filters: `actor`, `action`, `limit` ≤ 1000) |
| `GET /api/audit/export?format=pdf` | Multi-page PDF audit table (`%PDF-1.4`, WinAnsi-safe) |
| `POST /api/reports` | Generate + deliver a PDF report now (optionally targeted at one user via `recipientId`) |
| `GET /api/reports` | List generated reports |

## Scheduled delivery

`POST /api/reports` generates the PDF (written under `REPORT_DIR`, default `artifacts/reports/`) and **delivers** it:

1. A durable `report.generated` **notification** is recorded (see **Notifications**).
2. If a notification channel is configured, the report is dispatched through it (webhook/Slack/Discord/Teams/SMTP).

## Per-user targeting

Pass `recipientId` to deliver a report to **one user privately**: the recipient sees the private notification, and other users (including admins) do not — recipient isolation is enforced in the feed.

## Auditing the reports themselves

Every report generation is itself an audited action — the compliance trail covers the reporters.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `REPORT_DIR` | `artifacts/reports` | Where generated PDFs are written |
