/**
 * Mesh API client (Phase 4.0 4.6 — federated agent mesh). Mirrors the REST
 * contract in `apps/api/src/core/mesh/mesh.controller.ts`:
 *   GET    /api/mesh/topology          → { peers, counts }
 *   POST   /api/mesh/peers             { name, baseUrl, apiKey? } → { peer } | 409/400/503
 *   POST   /api/mesh/peers/:id/probe   → { peer }
 *   DELETE /api/mesh/peers/:id         → { ok }
 * The whole surface is admin-gated server-side (core:mesh:manage).
 */

import { API_BASE } from "./api-base";
import { authHeaders } from "./api";

export type MeshPeerStatus = "unknown" | "up" | "down";

export interface MeshPeerView {
  id: string;
  name: string;
  baseUrl: string;
  /** SHA-256 hex — only set when an API key was registered. */
  apiKeyHash: string | null;
  status: MeshPeerStatus;
  lastSeen: string | null;
  lastError: string | null;
  lastProbedAt: string | null;
}

export interface MeshTopologyView {
  peers: MeshPeerView[];
  counts: { total: number; up: number; down: number; unknown: number };
  /** The prober's configured interval (ms) — the view derives its poll cadence from this. */
  probeIntervalMs: number;
}

/** The same empty-counts shape the API returns (mirrored from mesh.service). */
export const EMPTY_COUNTS = { total: 0, up: 0, down: 0, unknown: 0 };

/** Fallback poll cadence when the server hasn't answered yet (10s, as before). */
export const DEFAULT_POLL_MS = 10_000;

/** Register outcome — success carries the fresh peer, failure carries the reason. */
export type RegisterPeerResult = { peer: MeshPeerView } | { error: string };

export async function fetchMeshTopology(token: string | null): Promise<MeshTopologyView | null> {
  const res = await fetch(`${API_BASE}/mesh/topology`, { headers: authHeaders(token) });
  if (!res.ok) return null;
  return (await res.json()) as MeshTopologyView;
}

export async function registerMeshPeer(
  token: string | null,
  input: { name: string; baseUrl: string; apiKey?: string },
): Promise<RegisterPeerResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/mesh/peers`, {
      method: "POST",
      headers: authHeaders(token, true),
      body: JSON.stringify(input),
    });
  } catch {
    return { error: "Mesh API unreachable." };
  }
  if (!res.ok) {
    // The API returns a precise reason per status (409 duplicate, 400
    // invalid, 503 no-db, 500 failed) — surface it instead of guessing.
    try {
      const body = (await res.json()) as { message?: string | string[] };
      const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
      return { error: message ?? `HTTP ${res.status}` };
    } catch {
      return { error: `HTTP ${res.status}` };
    }
  }
  const data = (await res.json()) as { peer?: MeshPeerView };
  return data.peer ? { peer: data.peer } : { error: "Unexpected response from the mesh API." };
}

export async function probeMeshPeer(token: string | null, id: string): Promise<MeshPeerView | null> {
  const res = await fetch(`${API_BASE}/mesh/peers/${id}/probe`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { peer?: MeshPeerView | null };
  return data.peer ?? null;
}

export async function removeMeshPeer(token: string | null, id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/mesh/peers/${id}`, { method: "DELETE", headers: authHeaders(token) });
  return res.ok;
}
