import type { PluginSummary } from "./types";
import { API_BASE } from "./api-base";
import { authHeaders } from "./api";

/**
 * Client-side mutation calls for `POST /api/plugins/:id/enable|disable`
 * Guarded server-side by `core:plugin:manage` — always
 * pass the caller's bearer token. Never throws: callers (AdminConsole) drive
 * optimistic UI off the returned discriminated result and revert on `!ok`.
 */
export type PluginActionOutcome = { ok: true; plugin: PluginSummary } | { ok: false; message: string };

async function mutatePluginState(
  id: string,
  action: "enable" | "disable",
  token: string | null,
): Promise<PluginActionOutcome> {
  if (!token) {
    return { ok: false, message: "You must be signed in to do that." };
  }
  try {
    const res = await fetch(`${API_BASE}/plugins/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      headers: authHeaders(token),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "You don't have permission to do that." };
    }
    if (res.status === 404) {
      return { ok: false, message: "This module no longer exists." };
    }
    if (!res.ok) {
      return { ok: false, message: `Request failed (HTTP ${res.status}).` };
    }
    const plugin = (await res.json()) as PluginSummary;
    return { ok: true, plugin };
  } catch {
    return { ok: false, message: "Can't reach the Constellation API." };
  }
}

export function enablePlugin(id: string, token: string | null): Promise<PluginActionOutcome> {
  return mutatePluginState(id, "enable", token);
}

export function disablePlugin(id: string, token: string | null): Promise<PluginActionOutcome> {
  return mutatePluginState(id, "disable", token);
}
