# Workflows — visual automation

> Compose agent steps and tool steps into reusable workflows with a drag-and-drop builder, run them on demand or via triggers, and watch the per-step trail.

## What a workflow is

A workflow is an ordered list of **steps**:

| Step type | What it does |
|---|---|
| **Agent step** | Runs a prompt through the engine (a real agent task) |
| **Tool step** | Invokes a plugin tool directly (e.g. a graph query) |

Steps can be **templated** with the results of earlier steps:

```
{{steps.<stepId>.result}}   → the previous step's output
{{steps.<stepId>.error}}    → the previous step's error message
```

## Building a workflow

1. Open **Workflows** (`/workflows`).
2. **Create workflow** — name it, then add steps.
3. Drag to **reorder** steps (drag-and-drop).
4. For an agent step: prompt (templates allowed) + model.
5. For a tool step: plugin + tool + arguments (templates allowed).
6. **Save.**

> **TIP:** A classic two-step workflow: step 1 = agent prompt "summarize the status of task X", step 2 = tool step that writes the summary somewhere. The templated argument `{{steps.step1.result}}` wires them together.

## Running

- **Manual**: from the workflows page, click **Run** — the engine executes the steps in order and stops at the first failure.
- **Scheduled**: attach a cron schedule with `workflowId` — firing the schedule **runs the workflow** instead of enqueuing a plain task.
- **Event-triggered**: attach an event (e.g. `engine.task.failed`) — when the event fires, the workflow runs automatically. This is the **autonomous incident-response primitive**: a workflow on `engine.task.failed` remediates failures.

## Watching the trail

Every run produces a **run trail**: per-step outcome (completed/failed) with the templated inputs actually used. Open the workflow's run history to inspect.

## Managing

- **CRUD**: create, update, delete.
- **Triggers re-sync**: enabling/disabling a schedule or changing a workflow re-syncs the armed triggers.
- **RBAC**: `core:workflow:manage` (admin; `platform:admin` implies it).

## API

| Endpoint | Purpose |
|---|---|
| `GET/POST /api/workflows` | List / create |
| `GET/PUT/DELETE /api/workflows/:id` | Detail / update / delete |
| `POST /api/workflows/:id/run` | Run now |
| `GET /api/workflows/:id/runs` | Run history + trail |
