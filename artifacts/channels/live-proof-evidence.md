# Live-proof evidence — Phase 3.0 · NOTIFICATION CHANNELS (2026-08-04)

Round B of the "finish the roadmap" pass — Polaris. Files: `channel-*.json`,
`channels-list.json`, `test-slack.json`, `webhooks.log` (LITERAL delivery
record), `channels-panel.png` / `channels-test-toast.png` (browser).

## What shipped
- **`NotificationChannelService`** (`apps/api/src/core/notifications/`): webhook
  channels (generic / Slack / Discord / Teams envelope dialects), stored under
  one core settings key; per-channel `kinds` filter (empty = all); enabled
  toggle; fire-and-forget delivery via global `fetch` + `AbortSignal.timeout`
  (a failing webhook NEVER breaks the feed); no-DB → empty list.
- **REST** (`/api/notifications/channels`): GET list, POST upsert (400 on bad
  name/url/format), DELETE :id (404), POST :id/test.
- **New engine events** so the vision's "task completed / failed /
  needs-approval" are real: `engine.task.completed` + `engine.task.paused`
  (worker + EngineAlertService) → durable notifications + channel delivery.
- **Portal**: admin Channels tab on /notifications (add form with kind
  checkboxes + All-events, channel cards with enabled/format/kinds, Test with
  toast, Remove).
- Tests: **+16** (envelope mapping ×5, channel CRUD/delivery/dispatch ×6,
  notification mappings completed/paused ×2, dispatch + throwing-dispatch ×2,
  alert completed/paused ×1). api **516 → 532**.

## LIVE PROOF (embedded boot + LOCAL webhook listener on :9080)
Channels: `generic-proof` (ALL events, generic JSON) + `slack-proof`
(engine.task.failed ONLY, slack `{text}` envelope). Literal `webhooks.log`:
1. completed task → `/hook` got `{"title":"Task completed","message":"Finished
   successfully","kind":"engine.task.completed","severity":"success",…}` (generic
   only — the slack channel's kind filter correctly EXCLUDED it).
2. doomed task (unknown model → terminal 404) → `/hook` got the
   `engine.task.failed` payload AND `/slack` got `{"text":"Task failed — Model
   router error: Ollama returned HTTP 404: …"}` — kind filter + slack envelope
   both live.
3. `POST /channels/:id/test` → `{"ok":true,"status":200}` and the listener
   received "Constellation test message — Channel \"slack-proof\" is wired up
   correctly."
Counts: `/hook` 2 hits · `/slack` 2 hits (failure + test) — exactly as designed.

## REAL BROWSER (CDP)
`scripts/flow-channels.json`: login → /notifications → **Channels tab** (tabs
now Feed / Audit log / Channels) → both channels rendered (ENABLED badges,
format chips, URLs, kind filters, Test/Remove) → clicked **Test** on
generic-proof → toast "Test message delivered" → the listener log gained the
browser-initiated hit at the same second. Screenshots vision-verified.

## Gates
api 532 (+16) · web typecheck clean, lint 0 errors (17 pre-existing warnings) ·
full four-gate 20/20 in the round-close pass.
