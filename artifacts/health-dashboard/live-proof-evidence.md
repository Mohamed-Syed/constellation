# Phase 2.0 item 2.4 — Portal /health Dashboard: LIVE-PROOF EVIDENCE (2026-08-04)

Round: portal `/health` route rendering the engine health endpoint as a live,
operator-facing dashboard. Local, $0.

## What was proven (real Chrome, zero-dep CDP driver `scripts/cdp-browser.mjs`)

Full stack live: postgres :5432, redis :6380, ollama qwen2.5-coder:7b,
graphify :8791, api :4001 (`scripts/boot-api-v0.3.sh`), web `next dev -p 3005`,
flow `scripts/flow-health.json` (login as admin → `/health`).

Screenshot: `artifacts/health-dashboard/health-dashboard.png` (browser-verified):

1. **"Engine Health" heading + green "Engine available" badge** — the live
   `GET /api/engine/health` verdict (engine: "available", reason: null).
2. **Queue depth card** — Waiting 0 · Active 0 · Failed jobs 0 · Failed tasks 0
   (the v0.5 durable dead-letter count renders alongside BullMQ job counts).
3. **Model providers card** — `ollama` (qwen2.5-coder:7b) **reachable** +
   `openrouter` card, rendered from the aggregated `model.providers[]` payload.
4. **Scheduler card** — Poll loop **running**, poll interval 30s, last sweep
   13s ago, due count + event hooks.
5. **Supervisor card** — Stale found 0 · Recovered 0 · Stalled (DLQ) 0.
6. **Alert trail card** — "All quiet — no engine alerts recorded this process
   lifetime." (the honest empty state).
7. **Sidebar** — "Health" nav item (Activity icon) present and highlighted as
   the active route.
8. **Live poll** — footer "Auto-refreshes every 5s · Last updated 0s ago" with
   the server timestamp — the 5s client poll loop was live.

## What shipped

- `apps/web/src/app/health/page.tsx` — thin server wrapper (public data source).
- `apps/web/src/components/health/health-dashboard.tsx` — client dashboard:
  5s poll, DESIGN_SKILL language (surface/surface-hover cards, staggered
  `Reveal`, both themes), honest degraded states (API unreachable banner,
  engine unavailable pill+reason, empty alert trail).
- `apps/web/src/lib/engine.ts` — `EngineHealth` interface extended to the real
  v0.5 payload (queue.enabled/failedTasks, model.providers[], scheduler,
  supervision, alerts) + `EngineAlert` type. The old client shape predated
  v0.4/v0.5 and would have dropped scheduler/supervision/alerts.
- `apps/web/src/lib/nav.ts` — `core-health` nav item (Activity, order 50).
- `scripts/flow-health.json` — reusable browser flow.

## Verification

- `turbo run typecheck build --filter=@constellation/web --force` → 2/2 green.
- Full repo gate: lint/build/typecheck/test → 20/20 (see round record).
- Browser proof: the dashboard rendered LIVE data in a real Chrome (screenshot
  + text dump in this artifact dir).

## Honest notes

- The page sits behind the portal's session guard (like `/engine`) — the
  health ENDPOINT is public, but the shell redirects unauthenticated browsers
  to `/login?redirect=%2Fhealth`; the flow logs in first.
- UI-only round: no test-count delta (web has no unit suite; build+typecheck
  are its gates).
