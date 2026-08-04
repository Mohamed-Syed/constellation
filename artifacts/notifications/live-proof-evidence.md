# Live-proof evidence — Phase 3.0 item 3.4 · NOTIFICATION CENTER (2026-08-04)

Round: `feat(notifications)` — Polaris solo round. All evidence files live in
this directory; every number below is literal output captured during the run.

## Stack

- postgres :5432 (compose default), redis :6380, ollama `qwen2.5-coder:7b`,
  api :4001 **embedded** (the EventBus is in-process — separate worker mode
  would split-brain the notification feed, so embedded is the honest mode).
- Boot: `scripts/live-proof-notifications.sh` (boot + events + REST in ONE
  invocation; api log: `artifacts/notifications/api.log`).
- Boot log lines (from `api.log` / script output):
  - `Mapped {/api/notifications, GET} route`
  - `Mapped {/api/notifications/unread-count, GET} route`
  - `Mapped {/api/notifications/read-all, POST} route`
  - `Mapped {/api/notifications/:id/read, POST} route`
  - `Mapped {/api/notifications/:id, DELETE} route`
  - `[NotificationService] Notification center listening on 5 platform topics`

## 1. REAL platform events → durable notifications (5/5 topics proven live)

| Topic | Trigger | Evidence file | Result |
|---|---|---|---|
| `scheduler.schedule.fired` | cron `* * * * *` schedule auto-fired by the scheduler poll loop | `01-list-after-schedule-fired.json` | ✅ PASS |
| `engine.task.failed` | task with unknown model `ollama:does-not-exist-notif-probe` → Ollama 404 → terminal failure | `02-list-after-task-failed.json` | ✅ PASS |
| `engine.task.stale` | supervisor flagged a crafted stale `running` row (status= running, updatedAt −1h; job WAITING not active → supervisor race-guard passes) | `03-list-after-stale.json` | ✅ PASS |
| `engine.task.recovered` | supervisor re-enqueued the stale task (resume-once) | `04-list-after-recovered.json` | ✅ PASS |

Stale-craft SQL (evidence: `sql-stale-craft.txt`):
`UPDATE core."agent_tasks" SET status='running', "updatedAt"=now()-interval '1 hour' WHERE id='cmsf19kd5000c9wfxo42tlhb6'`
→ notification message rendered literally: `No progress for 3602110ms` (60 min,
matches the poke). Both worker slots were occupied by two long CPU tasks so the
crafted task's job sat WAITING — a live worker would have been skipped by the
supervisor's active-job race guard by design (that's correct behaviour).

Also observed under repetition: the `* * * * *` cron schedule kept firing every
minute while the api stayed up (~20 min) and **every fire was durably
persisted** (20 `scheduler.schedule.fired` rows — the pipeline survives
repeated events; the schedule was then deleted via the REST API).

## 2. REST round-trip (literal responses in `05`–`13` files)

- `GET /api/notifications/unread-count` → `{"unreadCount": 4}`
- `POST /api/notifications/:id/read` → `{"id": "cmsf19gby…", "read": true}`
- `POST /api/notifications/read-all` → `{"updated": 3}`
- `GET /api/notifications/unread-count` → `{"unreadCount": 0}`
- `DELETE /api/notifications/:id` → `{"id": "cmsf19gby…", "dismissed": true}`
- `POST /api/notifications/nonexistent/read` → **HTTP 404**
- `GET /api/notifications` (no token) → **HTTP 401**
- `GET /api/notifications?unread=true&kind=scheduler.schedule.fired` → filtered
  list works (kind + unread combined)
- Final feed (`13-final-list.json`): 3 notifications, unread 0 — e.g.
  `[success] engine.task.recovered | Task recovered | Re-enqueued after being flagged stale`

## 3. REAL browser (zero-dep CDP, headless Chrome, web dev :3005)

Flow: `scripts/flow-notifications.json` → login → `/notifications` →
feed+badge → click row (mark read) → Mark all read → Audit log tab.

- Feed eval: `badge=4;feedRows=21;fired=true;failed=true;tabs=true` (4 unread on
  the sidebar badge, 21 rows, both Feed+Audit log tabs present)
- Screenshot `notifications-feed-badge.png` (vision-verified): sidebar
  **Notifications badge = 4** (accent pill), "Schedule fired" rows with
  severity dots + task refs + relative timestamps, filter chips
  All/Unread(4)/Tasks/Schedules, "Mark all read" button, Feed + Audit log tabs.
- After clicking row 1: `row1UnreadAfterClick=no` (unread dot cleared
  client-side optimistically + POST mark-read).
- After "Mark all read": badge cleared (`wait …aria-label*="unread
  notification" === null` → true), screenshot `notifications-marked-read.png`
  (vision-verified: **no badge on the sidebar item**, feed intact).
- Audit log tab: `opened audit tab` → rendered real entries
  (auth.login, engine.schedule.created, engine.schedule.deleted, workflow.run,
  plugin.install/uninstall from the DB trail), screenshot
  `notifications-audit-tab.png` (vision-verified: tab active, entries with
  action/actor/metadata/timestamp).

## 4. Bugs found LIVE (offline gates could not catch)

1. **NestJS DI trap #3 (the documented class): `import type { PrismaService }`
   erased the runtime metadata** → `Nest can't resolve dependencies of the
   NotificationService (?, EventBusService) … argument Function at index [0]`
   at boot. Every offline `new NotificationService(...)` test stayed green.
   Fixed: VALUE import (same fix as the OTel round).
2. **React effect bug in the audit tab** (browser-only, invisible to gates):
   `auditLoading` in the effect's dependency array made `setAuditLoading(true)`
   re-run the effect, whose cleanup flipped `active=false` and discarded the
   in-flight fetch — the tab spun on "Loading audit trail…" forever. Fixed by
   removing `auditLoading` from the deps (+ comment). The browser proof is the
   ONLY thing that can catch this class.

## 5. Gates (final pass on the tree as left)

`turbo run lint build typecheck test --force --concurrency=1` → **20/20 tasks,
0 cached** · tests **637** (api **513** = 491+22: 19 notification service + 3
scheduler emission; sdk 21 · graphify 40 · browser-use 47 · cli 16).
Web: typecheck clean, lint 0 errors (17 pre-existing warnings).

## 6. Cleanup performed

- Ports 4001/3005 freed (owner-killed), verified free.
- `docker compose down --volumes` (dev postgres/redis data wiped per round
  convention; the pre-existing federation overlay + graphify left running).
- Cron schedules from the proof deleted via REST (the v0.8-round leftover
  schedule was wiped with the volume).
- Nothing pushed; keys untouched; `.env` never sourced into the shell.
