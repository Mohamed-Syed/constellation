# Scheduler — run while you sleep

> The scheduler turns the engine into a 24/7 worker: recurring cron schedules and event-triggered schedules that auto-enqueue tasks — or fire whole workflows.

## Schedule types

| Type | Triggers | Example |
|---|---|---|
| **Cron** | A 5-field cron expression, evaluated by a built-in parser | `0 8 * * *` — every day at 08:00 |
| **Event** | A platform event (task failures, alerts, …) | Run a remediation workflow on `engine.task.failed` |

Every fire auto-enqueues a **system-authored task** (or runs a workflow — see **Workflows**) and advances `runCount`.

## Managing schedules

1. Open **Schedules** (Engine page → Schedules, or the API below).
2. **Create**: name, cron expression (or event type), the task to enqueue (prompt + model) — or pick a workflow to fire.
3. **Enable / disable**: a disabled schedule stops firing but keeps its definition.
4. **Delete**: removes it.

### Scoping

- **Team-scoped schedules** carry a `teamId`: a non-admin may create schedules only under teams they belong to (403 otherwise); a team-global schedule requires admin.
- Listing is scoped: admins see everything; everyone else sees their own + their teams'.

## Skill installs are schedules

Installing a **skill** from the Skills page creates a real `skill:<id>` cron schedule (see **Skills**). Uninstalling removes it.

## Events you can trigger on

| Event | Meaning |
|---|---|
| `engine.task.failed` | A task failed terminally |
| `engine.task.stale` | A task went stale |
| `engine.task.recovered` | The supervisor recovered a stale task |
| `engine.task.completed` | A task completed |
| `engine.task.paused` | A task paused for approval |
| `engine.alert.fired` | An alert webhook was ingested (see **Alerts**) |

## Watching it work

- The **Health** page shows the scheduler's last sweep and due count.
- Every fired schedule persists a `scheduler.schedule.fired` notification (see **Notifications**).
- The engine **audit** records schedule creation/enable/disable/delete.

## API

| Endpoint | Purpose |
|---|---|
| `GET/POST /api/schedules` | List / create |
| `POST /api/schedules/:id/enable` · `disable` | Toggle |
| `DELETE /api/schedules/:id` | Remove |
| `GET /api/schedules/:id` | Detail (incl. runCount) |

> **TIP:** The classic first demo — create a `* * * * *` schedule and watch a new task appear and complete every minute, `runCount` advancing on its own.
