# Supervisor & dead letters

> The engine's reliability layer: it detects tasks that are stuck, recovers them, classifies failures into a durable dead-letter list, and alerts on events. This is the machinery behind the AI Controller's recovery actions.

## The supervisor

The supervisor runs on an interval (`SUPERVISOR_POLL_INTERVAL_MS`, default 30s):

1. Finds tasks in `running` whose last progress is older than the stale threshold (`SUPERVISOR_STALE_THRESHOLD_MS`, default 300s = 5 minutes).
2. Decides per task:
   - **Recover** — if it is genuinely stuck with no work in flight, flip it back to `queued` (resume-once semantics) so the worker retries from its last checkpoint.
   - **Fail as stalled** — if it cannot be recovered safely, mark it `failed` with a `stalled` classification.
3. Skips tasks that are actively being worked (never double-claims).

Each sweep result is logged (`Supervisor sweep: N stale, N recovered, N failed`) and the **Health** page shows the supervisor's live state.

## Dead letters (the durable DLQ)

A task that fails terminally lands in the **dead-letter list** (`status = failed`) with:

- the **failure classification** (e.g. `stalled`, model error, max-steps),
- the **final error message**,
- its usage/cost snapshot.

The dead-letter count is distinct from BullMQ's internal failed-job count — it is the durable record operators act on.

## Where dead letters surface

| Surface | What it shows |
|---|---|
| **Engine page** | The failed-status filter tab with counts; open a task for the error |
| **Notifications** | `engine.task.failed` / `engine.task.stale` / `engine.task.recovered` events in the feed |
| **AI Controller** | A `dead-letter` finding ("N task(s) failed terminally…") that drops the stability score, with **re-enqueue-deadletters** recommended |
| **CLI** | `constellation ops deadletters` |

## Recovering dead letters

1. **Manually** — Engine → open the failed task → **Re-run**.
2. **One click** — AI Controller → Safe actions → **Run re-enqueue-deadletters** (flips every failed task back to `queued`, oldest first; a failed enqueue leaves the row failed and visible — never hidden).
3. **Automatically** — the AI Controller's autonomous watch re-enqueues dead letters on its own cadence (cooldown-limited; see **Autonomous watch**).

> **NOTE:** Re-enqueued tasks that fail again return to the dead-letter list with their (new) error. That is honest behavior — dead letters often fail again — and it keeps the loop observable.

## CLI

```
constellation ops engine status     # queue + supervisor + scheduler live state
constellation ops deadletters       # the durable DLQ with classifications
```

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `SUPERVISOR_POLL_INTERVAL_MS` | `30000` | How often the supervisor sweeps |
| `SUPERVISOR_STALE_THRESHOLD_MS` | `300000` | How long a `running` task may be silent before it is stale |
