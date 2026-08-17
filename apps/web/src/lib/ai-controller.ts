/**
 * Agentic AI Controller client (Phase 5.0). Mirrors the REST contract in
 * `apps/api/src/core/ai-controller/ai-controller.controller.ts`:
 *   GET  /api/ai-controller/status  → { generatedAt, score, label, findings, actionsRecommended }
 *   GET  /api/ai-controller/actions → { actions: string[] }
 *   POST /api/ai-controller/act     { action } → { ok, ran, message }
 * Admin-gated server-side (core:audit:read — platform:admin implies it).
 */

import { API_BASE } from "./api-base";
import { authHeaders } from "./api";

export type FindingSeverity = "ok" | "info" | "warn" | "crit";

export interface ControllerFinding {
  id: string;
  severity: FindingSeverity;
  area: string;
  title: string;
  detail: string;
}

export interface ControllerWatchStatus {
  enabled: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  lastScore: number | null;
  lastLabel: string | null;
  lastAction: string | null;
  lastActionAt: string | null;
}

export interface ControllerSnapshot {
  generatedAt: string;
  score: number;
  label: string;
  findings: ControllerFinding[];
  actionsRecommended: string[];
  /** The autonomous watch loop's live state (Phase 5.0 HEAL). */
  watch?: ControllerWatchStatus;
}

export interface ControllerActionResult {
  ok: boolean;
  ran: boolean;
  message: string;
}

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  ok: "OK",
  info: "Info",
  warn: "Warn",
  crit: "Critical",
};

export async function fetchControllerStatus(token: string | null): Promise<ControllerSnapshot | null> {
  try {
    const res = await fetch(`${API_BASE}/ai-controller/status`, { headers: authHeaders(token) });
    if (!res.ok) return null;
    return (await res.json()) as ControllerSnapshot;
  } catch {
    return null;
  }
}

export async function fetchControllerActions(token: string | null): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/ai-controller/actions`, { headers: authHeaders(token) });
    if (!res.ok) return [];
    const data = (await res.json()) as { actions?: string[] };
    return data.actions ?? [];
  } catch {
    return [];
  }
}

export async function runControllerAction(
  token: string | null,
  action: string,
): Promise<ControllerActionResult> {
  try {
    const res = await fetch(`${API_BASE}/ai-controller/act`, {
      method: "POST",
      headers: authHeaders(token, true),
      body: JSON.stringify({ action }),
      // A hung act (api wedged mid-sweep) must release the action panel, not
      // leave every Run button spinning forever.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // The API surfaces the precise reason as `message` (400 = not whitelisted).
      try {
        const body = (await res.json()) as { message?: string | string[] };
        const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
        return { ok: false, ran: false, message: message ?? `HTTP ${res.status}` };
      } catch {
        return { ok: false, ran: false, message: `HTTP ${res.status}` };
      }
    }
    return (await res.json()) as ControllerActionResult;
  } catch {
    return { ok: false, ran: false, message: "AI Controller API unreachable." };
  }
}
