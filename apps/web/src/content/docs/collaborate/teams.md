# Teams & team spaces

> Organize people into organizations → teams → members with explicit roles, and scope work (tasks, schedules, workflows) to teams.

## Structure

```
Organization
└── Team
    ├── owner      (one; the creator)
    ├── admin      (can manage members)
    └── member     (can use the team)
```

## Managing teams

1. Open **Teams** (`/teams`).
2. **Create team** — you become its **owner** (role badge shown on the card).
3. **Add member** — enter the member's email and pick a role.
4. **Remove member** — the **owner is protected**: you cannot remove the owner through the UI (or the API enforces it server-side).

## Scoping work to a team

| Surface | How team scoping applies |
|---|---|
| **Tasks** | A task can carry a `teamId`; non-admins see their own tasks + their teams' tasks (never other teams') |
| **Schedules** | Non-admins may create schedules only under teams they belong to (403 otherwise); team-global schedules require admin |
| **Workflows** | Carry `teamId` + `createdBy` (the workflows surface stays `core:workflow:manage`) |
| **Delegations** | Crew trees are team-scoped in the API projection |

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/teams` | Create (creator becomes owner) |
| `GET /api/teams` | List (scoped) |
| `GET /api/teams/:id` | Detail |
| `POST /api/teams/:id/members` | Add member `{email, role}` |
| `DELETE /api/teams/:id/members/:userId` | Remove member (owner-protected) |
| `GET /api/auth/me` | Your profile incl. teams |

## Permissions in practice

- **Admin** can manage any team.
- **Viewer** gets 403 on member management and on creating team-scoped work outside their teams.
- Role checks are enforced server-side; the UI just hides what you cannot do.
