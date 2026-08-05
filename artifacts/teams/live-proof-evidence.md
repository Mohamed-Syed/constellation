# Live-proof evidence — Phase 3.0 item 3.7 · TEAM SPACES — portal + full round (2026-08-05)

Polaris. Completes the round whose API shipped at `418c0d8`. Files: `team-created.json`,
`member-added.json`, `team-task.json` / `team-task-final.json`, `viewer-me.json`,
`viewer-teams.json`, `viewer-team-detail.json`, `viewer-team-tasks.json`,
`viewer-forbidden.json`, `teams-list.png`, `teams-detail.png` (browser).

## What shipped (this slice)
- Portal `/teams` page + `TeamsView` (create team → owner, my-teams list with role
  badges, team detail with member emails/roles, add-member-by-email with role select,
  remove member — trash icon hidden for the owner; management controls only for
  owner/admin — the API enforces, the UI hides).
- `lib/teams.ts` client (fetchMyTeams/createTeam/fetchTeamDetail/addTeamMember/
  removeTeamMember) + `core-teams` nav entry (Users icon, order 25).
- Fix: `TaskService.findAll` projection now includes the persisted usage/cost fields
  (compare round stored them; the list view omitted them).

## LIVE PROOF (embedded api :4001 + real browser :3005)
API (literal records):
1. admin created `core-team` → `role: owner`, org auto-created.
2. admin added `viewer@constellation.local` → `{"member":{"email":"viewer@constellation.local","role":"member"}}`.
3. admin submitted a task WITH `teamId` → completed on ollama (provider recorded).
4. viewer `/api/auth/me` → `teams: [{'name': 'core-team', 'role': 'member'}]`.
5. viewer `GET /api/teams` → core-team member; `GET /api/teams/:id` → both members with roles.
6. viewer `GET /api/engine/tasks?teamId=` → sees the team task.
7. viewer `POST /api/teams/:id/members` → **HTTP 403** "Team member management
   requires the owner or an admin role." — RBAC inheritance live.
Browser (CDP flow): login admin → sidebar **Teams** active → Create-a-team card →
**My teams: core-team [OWNER]** → detail: **2 members · you can manage members**,
admin@constellation.local OWNER + viewer@constellation.local MEMBER (with remove
trash icon), **ADD MEMBER BY EMAIL** box with role select — all vision-verified.

## Gates
web typecheck + lint clean (17 pre-existing warnings, 0 errors) · api 38 files 554/554
in the round-close pass. Team spaces (3.7) now complete end-to-end.
