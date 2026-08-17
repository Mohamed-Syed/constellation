# CLI — command-line operations

> The `constellation` CLI gives operators the same visibility from the terminal. Run `constellation ops <subcommand>` for a live read of the platform.

## Setup

The CLI lives in the repo (`apps/cli`). From the repo root, the built binary is available via the workspace toolchain:

```
node apps/cli/dist/index.js ops health        # or the installed `constellation` binary
```

## The ops subcommands

| Command | Shows |
|---|---|
| `constellation ops health` | Overall platform health + engine availability |
| `constellation ops engine status` | Engine live state — queue, supervisor, scheduler |
| `constellation ops tasks` | Task list/status |
| `constellation ops schedules` | Schedules (incl. runCount) |
| `constellation ops deadletters` | The durable dead-letter list with failure classifications |
| `constellation ops plugins` | Installed plugins + health |

## Typical operator flow

1. `constellation ops health` — is the platform up?
2. `constellation ops engine status` — is the queue/supervisor/scheduler healthy?
3. `constellation ops deadletters` — anything failed terminally?
4. Recover from the portal (Re-run / AI Controller) or let the autonomous watch handle it.

## Notes

- The CLI reads the same API (`:4001` by default; configure the base as needed).
- It is read-only — mutations go through the portal/API (which enforce RBAC + audit).
