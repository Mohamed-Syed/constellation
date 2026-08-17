# Audit & compliance

> Everything that matters is recorded: every action — **including denials** — lands in the immutable audit log, filterable and exportable for compliance.

## The audit log

| Field | Meaning |
|---|---|
| When | Timestamp |
| Actor | Who (user email/id) |
| Action | What (e.g. `auth.login`, `task.create`, denial) |
| Metadata | Scoped detail (args/results are **never** logged) |

Denied attempts are recorded too — every 403 is traceable to the actor and reason.

## Viewing

- **Portal**: Notifications → **Audit** tab (admin).
- **API**: `GET /api/audit` with filters (`actor`, `action`, `limit` ≤ 1000).

## Exporting

| Format | Endpoint | Notes |
|---|---|---|
| CSV | `GET /api/audit/export?format=csv` | RFC-4180; metadata JSON-encoded; quote-safe |
| PDF | `GET /api/audit/export?format=pdf` | Multi-page audit table, `%PDF-1.4`, WinAnsi-safe |

- The **Export CSV** button on the Audit tab downloads and toasts.
- **Scheduled reports** (see **Scheduled reports**) generate PDFs on demand or on a schedule and deliver them through notification channels, optionally to a single user.

## What is audited (not exhaustive)

- Auth: logins, failures, denials
- Tasks: create, cancel, approve, reject, re-run, merge
- Schedules & workflows: create, enable/disable, delete, fires
- Plugins: install, uninstall, toggle
- Mesh: peer register, probe, route, remove
- Teams: create, member add/remove
- AI Controller: every acted / autonomous action
- Reports: generation + delivery

## RBAC

`core:audit:read` (admin; `platform:admin` implies it). Export endpoints are admin-only. A viewer gets 403 and that denial is itself audited.
