# Tasks — create, run, watch

> The Engine is where agents do real work. This article covers the full task lifecycle: create, run, watch, result, re-run, cancel, approve, and the failure paths.

## The task lifecycle

```
queued → running → completed
              ↘ failed (dead-lettered)   →  re-enqueue (re-run) or leave
              ↘ paused (needs approval)  →  approved → running | rejected → failed
```

## Creating a task

1. Open **Engine** (`/engine`).
2. Click **New task**.
3. Fill in:
   - **Title** — a human-readable name (required).
   - **Prompt** — the instruction for the agent (required).
   - **Model** — pick from the model list (the picker is populated from the engine's live health; the default is `deepseek-v4-flash`).
   - **Max steps** — the ReAct loop ceiling (default comes from `ENGINE_MAX_STEPS`, typically 20).
4. **Submit.**

> **TIP:** You can also create tasks with a team scope — see **Teams**.

## Watching a task run

- The task row shows its status and the model/provider that was actually used.
- Open the task detail dialog to see the **step history**, which streams live (a *live* badge pulses while the agent works).
- Each step shows the agent's **thought**, any **tool call** (tool + arguments), and the **tool result** (ok/error + data).

## Reading the result

- Completed tasks show a **Result** panel with the agent's final JSON output.
- **Copy** puts the result on the clipboard.
- The task record persists usage and cost: **input tokens, output tokens, and cost USD** (from the model provider's real pricing).

## Re-running a task

- Finished tasks (completed or failed) have a **Re-run** action — it enqueues the same prompt again as a fresh run.

## Cancelling

- `queued` or `running` tasks can be **Cancelled**; the worker honors the cancellation at the next step boundary.

## Approving / rejecting (when the approval gate is on)

- If the platform enforces approvals (see **Approval gate**), a task that requests a consequential tool call pauses at `paused`/`pending_approval`.
- **Approve** — the tool call executes exactly once and the run continues.
- **Reject** — the task fails with the audited reason.
- Approve/reject is honour-once: approving twice does not double-execute.

## Failure paths (dead letters)

- Tasks that fail terminally (e.g. `Reached max steps (N) without completing`) move to **failed** — the durable dead-letter list.
- The engine's **Supervisor** detects tasks stuck in `running` with no progress past the stale threshold and recovers or fails them (see **Supervisor & dead letters**).
- From the portal you can **Re-run** a dead letter; the **AI Controller** can re-enqueue all of them in one click or automatically.

## API reference

| Endpoint | Purpose |
|---|---|
| `POST /api/engine/tasks` | Create a task `{title, prompt, model?, maxSteps?, teamId?}` |
| `GET /api/engine/tasks` | List tasks (filters: status, team) |
| `GET /api/engine/tasks/:id` | One task with steps |
| `POST /api/engine/tasks/:id/cancel` | Cancel |
| `POST /api/engine/tasks/:id/rerun` | Re-run |
| `POST /api/engine/tasks/:id/approve` / `reject` | Approval gate |
| `GET /api/engine/deadletters` | The durable dead-letter list |
| `GET /api/engine/delegations` | Crew trees (see **Crews & delegation**) |
| `POST /api/engine/tasks/:id/merge` | Merge children results into the parent |
