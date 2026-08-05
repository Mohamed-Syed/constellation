# Live-proof evidence — Phase 4.0 · SKILL MARKETPLACE (4.4) (2026-08-05)

Polaris. Files: `catalog.json`, `install-a.json`/`install-b.json`, `schedules.json`,
`toggle.json`, `uninstall.json`, `skills-catalog.png` (browser, vision-verified).

## What shipped
- **`SkillService` + 7-skill catalog** (`SKILL_CATALOG`): daily-pr-triage, weekly
  dependency audit, SSL cert expiry monitor, nightly health check, weekly cost
  report, daily incident summary, weekly code review digest — each a packaged
  (cron + prompt template + maxSteps). **Install = a real `skill:<id>` cron
  scheduled task** — the existing scheduler engine runs it; no new tables.
- **REST** `GET /api/skills` (catalog + install state + nextRunAt) ·
  `POST /api/skills/:id/install|uninstall|toggle` — mutations admin-gated
  (PermissionsGuard + `core:plugin:manage` → 403 for the viewer).
- **Portal `/skills`** — card grid (category chips, cron, steps, install
  state badges active/paused, next-run time, Install/Resume/Uninstall), nav
  entry `core-skills` (Wrench, order 30).

## LIVE PROOF (real schedules, real RBAC)
- Catalog: 7 skills, 0 installed.
- Install daily-pr-triage (enabled, next run 2026-08-06T04:00Z) +
  ssl-cert-expiry-monitor → **two real schedules appear** in /engine/schedules:
  `skill:ssl-cert-expiry-monitor cron=0 7 * * *` and `skill:daily-pr-triage
  cron=0 8 * * *` (titles + enabled flags correct).
- Toggle → enabled:False; uninstall → ssl schedule removed, daily remains.
- **Viewer install → HTTP 403** (RBAC proven — found + fixed live: the
  `PermissionsGuard` must be attached per route, the metadata decorator alone
  doesn't enforce).
- Browser (vision-verified): /skills shows all 7 cards with category chips
  (GitHub/Security/Infrastructure/Operations/Finance), cron expressions,
  step counts, Install buttons — and the installed Daily GitHub PR triage card
  carries the yellow **paused** badge with Resume/Uninstall (matches the API
  state from the toggle).

## Gates
api **586** (42 files, +7 skills tests) · web typecheck/lint clean (17
pre-existing warnings) · full four-gate in the round-close pass.
