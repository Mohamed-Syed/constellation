/**
 * Teams API client (Phase 3.0 — team spaces). Mirrors the REST contract in
 * `apps/api/src/core/teams/teams.controller.ts`:
 *   POST   /api/teams            { name } → { team }
 *   GET    /api/teams            → { teams: [{ id, name, orgId, role }] }
 *   GET    /api/teams/:id        → { id, name, orgId, members: [{userId,email,role}] }
 *   POST   /api/teams/:id/members { email, role? } → { member }
 *   DELETE /api/teams/:id/members/:userId → { removed }
 */

import { API_BASE } from "./api-base";

export interface TeamSummary {
  id: string;
  name: string;
  orgId: string;
  role: string;
}

export interface TeamMemberView {
  userId: string;
  email: string;
  role: string;
}

export interface TeamDetailView {
  id: string;
  name: string;
  orgId: string;
  members: TeamMemberView[];
}

export async function fetchMyTeams(token: string | null): Promise<TeamSummary[]> {
  const res = await fetch(`${API_BASE}/teams`, { headers: auth(token) });
  if (!res.ok) return [];
  const data = (await res.json()) as { teams?: TeamSummary[] };
  return data.teams ?? [];
}

export async function createTeam(token: string | null, name: string): Promise<TeamSummary | null> {
  const res = await fetch(`${API_BASE}/teams`, {
    method: "POST",
    headers: auth(token, true),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { team?: TeamSummary };
  return data.team ?? null;
}

export async function fetchTeamDetail(token: string | null, id: string): Promise<TeamDetailView | null> {
  const res = await fetch(`${API_BASE}/teams/${id}`, { headers: auth(token) });
  if (!res.ok) return null;
  return (await res.json()) as TeamDetailView;
}

export async function addTeamMember(
  token: string | null,
  id: string,
  email: string,
  role: string,
): Promise<TeamMemberView | null> {
  const res = await fetch(`${API_BASE}/teams/${id}/members`, {
    method: "POST",
    headers: auth(token, true),
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { member?: TeamMemberView };
  return data.member ?? null;
}

export async function removeTeamMember(token: string | null, id: string, userId: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/teams/${id}/members/${userId}`, {
    method: "DELETE",
    headers: auth(token),
  });
  return res.ok;
}

function auth(token: string | null, json = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}
