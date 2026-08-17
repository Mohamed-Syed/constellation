/**
 * Delegation API client (Phase 4.0 backlog #1 — portal-wide delegation view).
 * Mirrors the REST contract in `apps/api/src/core/engine/engine.controller.ts`:
 *   GET /api/engine/delegations → { items: DelegationTreeNode[], total }
 * Scope: admin sees every crew root; others see personal + their teams' roots.
 */

import { API_BASE } from "./api-base";
import { authHeaders } from "./api";

export type AgentStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "paused";

export interface DelegationTreeNode {
  id: string;
  title: string;
  status: string;
  provider: string | null;
  model: string | null;
  actorId: string | null;
  teamId: string | null;
  stepCount: number;
  totalTokens: number | null;
  costUSD: number | null;
  createdAt: string;
  completedAt: string | null;
  children: DelegationTreeNode[];
  childCount?: number;
  childrenTotalTokens?: number | null;
  childrenCostUSD?: number | null;
}

export interface DelegationsResponse {
  items: DelegationTreeNode[];
  total: number;
}

/** Fetch every crew root (task with children) with its full delegation tree. */
export async function fetchDelegations(token: string | null): Promise<DelegationsResponse | null> {
  const res = await fetch(`${API_BASE}/engine/delegations`, { headers: authHeaders(token) });
  if (!res.ok) return null;
  return (await res.json()) as DelegationsResponse;
}

/** Merge a crew's descendant results onto the parent task. */
export async function mergeDelegation(token: string | null, parentId: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/engine/tasks/${parentId}/merge`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return res.ok;
}
