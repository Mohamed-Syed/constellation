# AI Controller — autonomous watch

> The HEAL slice: the controller does not wait for a human. On a fixed cadence it scores the platform, notifies you when the status changes, and runs the safe recovery actions by itself — cooldown-guarded, overlap-safe, and fully audited.

## How it works

1. Every `CONTROLLER_WATCH_INTERVAL_MS` (default **30000 ms** = 30s), the watch gathers the same live signals as `GET /status` and computes the snapshot.
2. **Watch**: if the label changed since the last tick, it records a transition notification:
   - degradation — `Platform status changed Healthy → Degraded (score 78). Issues: …`
   - recovery — `Platform status recovered to Healthy (score 92).`
3. **Heal**: for each recommended action on the autonomous whitelist (`reprobe-mesh`, `re-enqueue-deadletters`, `flush-stale`), it runs it **if the per-action cooldown has elapsed**.

> **NOTE:** `run-deepseek-diagnostic` is deliberately **not** autonomous — it spends model budget and is manual-only.

## Guardrails

| Guardrail | Detail |
|---|---|
| **Per-action cooldowns** | reprobe-mesh 60s, re-enqueue-deadletters **15 min**, flush-stale 5 min. A task that keeps re-failing cannot be churned into a loop. |
| **Overlap guard** | Ticks never run concurrently. |
| **Honest skip** | Actions that find nothing to do (`0 of 0`, sweep skipped) are not audited as successes. |
| **Full audit** | Every autonomous action persists an `ai-controller.autonomous` notification with the exact message + action. |
| **No-DB degrade** | With no services wired the tick still produces an honest snapshot and never throws. |

## Watching it live

- The **portal** shows an **Autonomous watch** card on `/ai-controller`: pulsing **ON** badge, cadence, last tick, last score/label, last action — the *Last tick* counter moves every tick.
- The **API log** prints each autonomous act:
  `[ControllerWatchService] AI Controller acted autonomously: re-enqueue-deadletters — Re-enqueued 2 of 2 dead-lettered task(s).`
- The **notifications** feed carries `ai-controller.autonomous` and `ai-controller.watch` events.

## Proving it (the canonical demo)

With two dead-lettered tasks and a down mesh peer present, start the API and wait one tick. No human clicks anything:

```
watch started — tick every 10000ms
AI Controller acted autonomously: reprobe-mesh — Re-probed all mesh peers.
AI Controller acted autonomously: re-enqueue-deadletters — Re-enqueued 2 of 2 dead-lettered task(s).
[AgentWorkerService] Job … (task …) completed     ← the re-enqueued tasks RAN
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `CONTROLLER_WATCH_ENABLED` | `on` | `off` disables the loop (manual `/status` + `/act` still work) |
| `CONTROLLER_WATCH_INTERVAL_MS` | `30000` | Tick cadence (min 5000) |
