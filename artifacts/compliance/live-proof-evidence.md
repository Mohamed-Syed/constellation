# Live-proof evidence — Phase 4.0 · COMPLIANCE / AUDIT EXPORT (2026-08-05)

Polaris. Files: `audit-export.csv` (literal 25-row export), `audit-export.png`
(browser), `api.log`.

## What shipped
- `GET /api/audit/export?actor=&action=&limit=` — RFC-4180 CSV download
  (`Content-Disposition` attachment), admin-only like the audit list; new
  `AuditService.listForExport` (actor/action substring filters, capped at
  1000 rows) + pure `auditToCsv` (metadata JSON-encoded, quoting tested).
- Portal: **Export CSV** button on the /notifications Audit log tab — fetches
  the CSV and triggers a download (toast on success/failure).

## LIVE PROOF
- `curl /api/audit/export?limit=25` → **HTTP 200, 2415 bytes** of real rows:
  `createdAt,actorId,action,metadata` header + `auth.login` rows with
  `{"target":"admin@constellation.local"}` metadata (RFC-4180 quoting intact).
- Filtered `?action=workflow&limit=5` → only `workflow.update`/`workflow.create`
  rows. No token → **401**.
- Real browser: login → /notifications → **Audit log** tab → **Export CSV**
  clicked → toast "Audit CSV downloaded." with the live trail rendered.

## Gates
api **571** (+3) · web typecheck + lint clean (17 pre-existing warnings) ·
full four-gate 20/20 in the round-close pass.
