# Approval gate

> Human-in-the-loop control for anything consequential. When enabled, the agent pauses before executing a sensitive tool call and waits for a human decision — approved calls run **exactly once**.

## When the gate applies

The gate is governed by two mechanisms:

1. **Per-plugin flags** — a plugin's manifest can mark a tool `requiresApproval: true` (the SDK contract).
2. **Platform-wide switch** — `ENGINE_REQUIRE_APPROVAL_ALL=true` forces every tool call to require approval.

## What the operator sees

1. A task that requests an approval-gated tool call pauses with status **paused** (pending approval) instead of continuing.
2. The **Engine** page shows the paused task; the detail dialog shows the pending tool call (tool + arguments).
3. The notification center may also carry an alert for the event.

## Decisions

| Action | Effect |
|---|---|
| **Approve** | The tool call executes **exactly once**; the run continues. Honour-once: a second approve does nothing. |
| **Reject** | The task fails with the audited reason (the rejection is recorded in the audit log). |

## Guarantees

- **No double-execute** — even if the worker restarts between approval and execution, the tool call runs at most once (the resume path replays the checkpoint, not the tool).
- **Audited** — approvals and rejections (with actor) are written to the audit log.
- **Kill-restart safe** — a task paused mid-run survives restarts and resumes at the right checkpoint.

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/engine/tasks/:id/approve` | Approve the pending call (executes once) |
| `POST /api/engine/tasks/:id/reject` | Reject with reason → task fails |

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `ENGINE_REQUIRE_APPROVAL_ALL` | `false` | `true` = every tool call pauses for approval |
| `ENGINE_AGENT_PERMISSIONS` | — | Named role seam for agent-side permission checks |
