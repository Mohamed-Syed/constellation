/**
 * Phase 3.0 — visual workflow builder: portal-side client for the workflow
 * REST surface (`apps/api/src/core/workflows`, guarded by core:workflow:manage).
 *
 * CONTRACT (read from the API source):
 *   POST   /api/workflows            { name, description?, definition } → Workflow
 *   GET    /api/workflows            → Workflow[] (newest first)
 *   GET    /api/workflows/:id        → Workflow + recent runs[]
 *   PUT    /api/workflows/:id        { name?, description?, definition? }
 *   DELETE /api/workflows/:id        → { id, removed }
 *   POST   /api/workflows/:id/run    → { id: runId, workflowId, status }
 *   GET    /api/workflows/:id/runs/:runId → WorkflowRun (outcome trail)
 *
 * Same never-throw discipline as lib/engine.ts.
 */
import { API_BASE } from "./api-base";

export type WorkflowStep =
  | { id: string; kind: "agent"; label?: string; prompt: string; model?: string; maxSteps?: number }
  | { id: string; kind: "tool"; label?: string; plugin: string; tool: string; args?: Record<string, unknown> };

export interface WorkflowDefinition {
  trigger: { type: "manual" | "cron" | "event"; cron?: string; event?: string };
  steps: WorkflowStep[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: "running" | "completed" | "failed";
  stepsResult: Array<{ id: string; kind: string; label: string; ok: boolean; result?: unknown; error?: string; taskId?: string; durationMs: number }> | null;
  error: string | null;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
}

export interface WorkflowDetail extends WorkflowSummary {
  runs: WorkflowRun[];
}

export type WorkflowResult<T> =
  | { state: "ok"; data: T }
  | { state: "forbidden"; message: string }
  | { state: "error"; message: string };

function authHeaders(token: string | null): HeadersInit | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

/** GET /api/workflows — newest first. */
export async function fetchWorkflows(token: string | null): Promise<WorkflowResult<WorkflowSummary[]>> {
  if (!token) return { state: "forbidden", message: "You must be signed in to view workflows." };
  try {
    const res = await fetch(`${API_BASE}/workflows`, { cache: "no-store", headers: authHeaders(token) });
    if (res.status === 401 || res.status === 403) return { state: "forbidden", message: "You need the workflow-manage permission." };
    if (!res.ok) return { state: "error", message: `The API returned HTTP ${res.status}.` };
    const data = (await res.json()) as WorkflowSummary[];
    return { state: "ok", data: Array.isArray(data) ? data : [] };
  } catch {
    return { state: "error", message: "Can't reach the Constellation API." };
  }
}

/** GET /api/workflows/:id — definition + recent runs. */
export async function fetchWorkflow(id: string, token: string | null): Promise<WorkflowResult<WorkflowDetail>> {
  if (!token) return { state: "forbidden", message: "You must be signed in." };
  try {
    const res = await fetch(`${API_BASE}/workflows/${encodeURIComponent(id)}`, { cache: "no-store", headers: authHeaders(token) });
    if (res.status === 401 || res.status === 403) return { state: "forbidden", message: "You need the workflow-manage permission." };
    if (!res.ok) return { state: "error", message: `The API returned HTTP ${res.status}.` };
    return { state: "ok", data: (await res.json()) as WorkflowDetail };
  } catch {
    return { state: "error", message: "Can't reach the Constellation API." };
  }
}

export type SaveWorkflowOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "unauthenticated" | "forbidden" | "bad-args" | "unreachable" | "error"; message: string };

/** POST /api/workflows — create a workflow. */
export async function createWorkflow(
  input: { name: string; description?: string; definition: WorkflowDefinition },
  token: string | null,
): Promise<SaveWorkflowOutcome> {
  if (!token) return { ok: false, reason: "unauthenticated", message: "You must be signed in." };
  try {
    const res = await fetch(`${API_BASE}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "forbidden", message: "You need the workflow-manage permission." };
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, reason: "bad-args", message: body?.message ?? "The workflow definition was rejected." };
    }
    if (!res.ok) return { ok: false, reason: "error", message: `Save failed (HTTP ${res.status}).` };
    const body = (await res.json()) as { id?: unknown };
    return { ok: true, id: typeof body.id === "string" ? body.id : "" };
  } catch {
    return { ok: false, reason: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/** PUT /api/workflows/:id — update (used for both edits and initial saves of a draft). */
export async function updateWorkflow(
  id: string,
  input: { name: string; description?: string; definition: WorkflowDefinition },
  token: string | null,
): Promise<SaveWorkflowOutcome> {
  if (!token) return { ok: false, reason: "unauthenticated", message: "You must be signed in." };
  try {
    const res = await fetch(`${API_BASE}/workflows/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "forbidden", message: "You need the workflow-manage permission." };
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, reason: "bad-args", message: body?.message ?? "The workflow definition was rejected." };
    }
    if (!res.ok) return { ok: false, reason: "error", message: `Save failed (HTTP ${res.status}).` };
    return { ok: true, id };
  } catch {
    return { ok: false, reason: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/** DELETE /api/workflows/:id. */
export async function deleteWorkflow(id: string, token: string | null): Promise<SaveWorkflowOutcome> {
  if (!token) return { ok: false, reason: "unauthenticated", message: "You must be signed in." };
  try {
    const res = await fetch(`${API_BASE}/workflows/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "forbidden", message: "You need the workflow-manage permission." };
    if (!res.ok) return { ok: false, reason: "error", message: `Delete failed (HTTP ${res.status}).` };
    return { ok: true, id };
  } catch {
    return { ok: false, reason: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/** POST /api/workflows/:id/run — fire a manual run. */
export async function runWorkflow(id: string, token: string | null): Promise<SaveWorkflowOutcome> {
  if (!token) return { ok: false, reason: "unauthenticated", message: "You must be signed in." };
  try {
    const res = await fetch(`${API_BASE}/workflows/${encodeURIComponent(id)}/run`, {
      method: "POST",
      headers: authHeaders(token),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "forbidden", message: "You need the workflow-manage permission." };
    if (!res.ok) return { ok: false, reason: "error", message: `Run failed (HTTP ${res.status}).` };
    const body = (await res.json()) as { id?: unknown };
    return { ok: true, id: typeof body.id === "string" ? body.id : "" };
  } catch {
    return { ok: false, reason: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/** GET /api/workflows/:id/runs/:runId — one run's outcome trail. */
export async function fetchWorkflowRun(id: string, runId: string, token: string | null): Promise<WorkflowResult<WorkflowRun>> {
  if (!token) return { state: "forbidden", message: "You must be signed in." };
  try {
    const res = await fetch(`${API_BASE}/workflows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`, {
      cache: "no-store",
      headers: authHeaders(token),
    });
    if (!res.ok) return { state: "error", message: `The API returned HTTP ${res.status}.` };
    return { state: "ok", data: (await res.json()) as WorkflowRun };
  } catch {
    return { state: "error", message: "Can't reach the Constellation API." };
  }
}
