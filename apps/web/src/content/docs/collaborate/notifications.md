# Notifications & channels

> A durable event feed for everything the platform does, plus outbound channels (webhook, Slack, Discord, Teams, SMTP email) that push the same events wherever you work.

## The feed

Open **Notifications** (`/notifications`) — the bell in the top bar shows an **unread badge**.

- Filters by kind/severity; severity icons on each row.
- **Mark read**, **Dismiss**, and **Mark all as read**.
- The **Audit** tab (admin) shows the audit log with **Export CSV**.

## What generates events

| Event kind | Trigger |
|---|---|
| `engine.task.failed` / `stale` / `recovered` / `completed` / `paused` | Task lifecycle |
| `scheduler.schedule.fired` / `error` | Schedules firing or failing |
| `ai-controller.acted` | A human ran a controller action |
| `ai-controller.autonomous` | The watch healed something by itself |
| `ai-controller.watch` | Platform status transitions (degraded / recovered) |
| `report.generated` | A compliance report was produced |
| `engine.alert.fired` | An alert webhook was ingested |

## Per-user targeting

Notifications can target **one user** (`recipientId`): the recipient sees it, everyone else (including admins) does not — used for private compliance reports.

## Outbound channels

1. Open **Notifications → Channels**.
2. **Add channel**: pick a type and configure:

| Type | Envelope |
|---|---|
| Generic webhook | `POST` JSON to a URL |
| Slack | Slack-formatted message |
| Discord | Discord embed/message |
| Teams | Office 365 card |
| SMTP | Email via your relay (host/port/user/pass/from) |

3. Set **per-kind filters** — e.g. deliver *only* `engine.task.failed` to Slack.
4. Toggle **enabled**, and use **Test** to fire a sample delivery and confirm the endpoint works.

> **TIP:** Channel delivery is fire-and-forget — a broken webhook never breaks the feed or the engine.

## The engine events you can automate on

The same event bus drives **event-triggered workflows** (see **Workflows**): a task failure, a stale task, an alert — each can launch a remediation workflow automatically.
