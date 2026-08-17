# Administration

> The admin surfaces: what an administrator can see and do beyond day-to-day operations.

## Admin vs. everyone else

- **Admin** (`platform:admin`) can manage users, roles, plugins, mesh, schedules, workflows, teams, the AI Controller, and exports — everything in the permission catalog (see **Sign in & roles**).
- **Viewer** and other non-admin roles are read-only or scope-limited; every protected action is enforced server-side (403) and audited.

## Admin surfaces in the portal

| Surface | What an admin can do |
|---|---|
| **Admin** (`/admin`) | Management console for platform objects |
| **Settings** (`/settings`) | Platform settings and feature flags |
| **Notifications → Audit** | Full audit log + CSV export |
| **Modules** | Plugin install/uninstall/enable/disable |
| **Mesh** | Peer registration, probe, route, remove |
| **AI Controller** | Read the snapshot, run recovery actions, watch the autonomous loop |
| **Teams** | All teams and member management |
| **Schedules / Workflows** | Everything, including team-global objects |

## Users & roles

- Seed accounts: admin + viewer (emails/passwords from `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`VIEWER_EMAIL`/`VIEWER_PASSWORD`).
- Roles map to permission sets; `platform:admin` satisfies every `core:*` requirement via wildcard matching.
- **Never hand an autonomous agent `platform:admin`** — the platform's own agents run with scoped permissions by design.

## Feature flags

`core:feature-flag:manage` controls feature flags; flags are read by plugins through the settings/feature-flag service.

## The AI Controller as an admin tool

The controller is effectively an admin's health lens:

- `GET /api/ai-controller/status` — live score + findings (read: `core:audit:read`).
- `POST /api/ai-controller/act` — safe recovery actions (write: `core:ai-controller:manage`).
- The **autonomous watch** runs the safe actions without a human, and every act is audited (see **AI Controller**).

## Operational hygiene (recommended)

1. Change the seeded admin/viewer passwords (or rotate via env) before real use.
2. Use the **viewer** account for routine browsing to prove least-privilege.
3. Check the **Health** page and the **AI Controller** score as your first daily look.
4. Review the **audit log** and notification feed for denials and autonomous actions.
5. Keep secrets in `.env` only — the repo ships zero keys.
