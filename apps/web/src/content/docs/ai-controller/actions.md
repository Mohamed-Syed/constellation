# AI Controller — safe actions

> The controller can only run actions from a **whitelist** of safe, idempotent recovery moves. Anything else is explicitly rejected — it can never guess a damaging mutation.

## The whitelist

| Action | What it does | When recommended | Cooldown (autonomous) |
|---|---|---|---|
| `reprobe-mesh` | Probes every registered mesh peer now | `mesh-down` finding | 60s |
| `re-enqueue-deadletters` | Flips failed (dead-lettered) tasks back to `queued`, **oldest first**, and re-runs them | `dead-letter` finding | 15 min |
| `flush-stale` | Runs one supervisor sweep (recover stale, fail stalled) | (available; also runs on its own cadence) | 5 min |
| `run-deepseek-diagnostic` | Enqueues a tiny diagnostic task on the default model (`DEFAULT_MODEL`) that replies `diagnostic-ok …` | — (manual only; it spends model budget) | — |

## Running an action

1. Open **AI Controller** (`/ai-controller`).
2. In **Safe actions**, click **Run** next to the action (or click a **Recommended** action button under the score hero).
3. The result arrives as a toast, and the page refreshes:

| Result shape | Meaning | Toast |
|---|---|---|
| `ok: true, ran: true` | It ran | green success |
| `ok: true, ran: false` | Nothing to do (e.g. `0 of 0` dead letters, sweep skipped) | neutral info |
| `ok: false` | It could not run (partial re-enqueue, queue unavailable, …) | red error with the honest reason |

## Safety properties

- **Enqueue-first ordering** — `re-enqueue-deadletters` adds the job to the queue *before* flipping the row: a failed enqueue leaves the task `failed` and visible, never parked in invisible limbo.
- **Status-gated requeue** — a task is only flipped if it is still `failed`; a task the worker already completed mid-loop can never be resurrected.
- **Honest counts** — a partial re-enqueue reports `Re-enqueued 1 of 2` with `ok:false`. Nothing is papered over.
- **No raw 500s** — `flush-stale` and every other action degrade to a clean, explained result even when the underlying service throws.

## Rejection

`POST /act` with an action not on the whitelist returns **400** listing the whitelist:

```
No safe controller action 'drop-everything'. Available: reprobe-mesh,
re-enqueue-deadletters, flush-stale, run-deepseek-diagnostic.
```

## Audit trail

Every action that actually **ran** is persisted as an `ai-controller.acted` notification with the exact message and the action name as the ref. See **Notifications**.

## API

| Endpoint | Purpose | Permission |
|---|---|---|
| `GET /api/ai-controller/status` | Live snapshot + watch state | `core:audit:read` |
| `GET /api/ai-controller/actions` | The whitelist | `core:audit:read` |
| `POST /api/ai-controller/act` | Run an action `{action}` | `core:ai-controller:manage` |
