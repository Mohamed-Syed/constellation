/**
 * The Engine — portal-side client for the agentic task runtime
 * (`apps/api/src/core/engine`, Engine v0 — HANDOFF §3 / §8 item 1b).
 *
 * CONTRACT (read from the API source, not invented — engine.controller.ts,
 * task.service.ts, task-queue.service.ts, model-router.service.ts):
 *
 *   POST /api/engine/tasks            (Bearer) { title, prompt, model?, maxSteps? }
 *                                       → { id, status: "queued", title, createdAt }
 *   GET  /api/engine/tasks            (Bearer) → TaskSummary[] (newest first, max 100)
 *   GET  /api/engine/tasks/:id        (Bearer) → TaskDetail (incl. full step history)
 *   POST /api/engine/tasks/:id/cancel (Bearer) → { id, status: "cancelled" }
 *   GET  /api/engine/health           (@Public) → { queue: {waiting,active,failed},
 *                                                   model: {provider,model,reachable,error?},
 *                                                   timestamp }
 *
 * Wire-shape notes (reconciled against the source so the UI doesn't guess):
 *   - `status` is a free String per the Prisma schema; the worker emits
 *     queued | running | paused | completed | failed | cancelled. Tolerate
 *     anything — unknown statuses render neutral.
 *   - The LIST route omits `prompt`/`result` (only the detail route includes
 *     them), so the table renders title/status/steps/created and the drawer
 *     fetches the detail.
 *   - Steps carry `type` ∈ thought | tool_call | tool_result | done | error
 *     and an opaque JSON `content` whose shape varies by type — see
 *     `stepSummaryText` for the per-type rendering.
 *   - `POST .../cancel` answers 400 when the task is already terminal or
 *     missing — the UI treats that as "nothing to do", not an error.
 *
 * Same "never throw" discipline as lib/brain.ts: every call returns a
 * discriminated result; callers degrade gracefully and the UI never blanks.
 */
import { API_BASE } from "./api-base";

/** The statuses the engine worker emits today (the API treats status as a free string). */
export type EngineTaskStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

/** Row shape returned by `GET /api/engine/tasks` (no `prompt`/`result` here). */
export interface EngineTaskSummary {
  id: string;
  title: string;
  status: string;
  model: string | null;
  provider: string | null;
  stepCount: number;
  maxSteps: number;
  actorId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  /** Multi-model compare round — cumulative usage persisted at the end of the run. */
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUSD: number | null;
}

/** Step types the ReAct loop writes (`agent-worker.service.ts`). */
export type EngineStepType =
  | "thought"
  | "tool_call"
  | "tool_result"
  | "pending_approval"
  | "done"
  | "error";

/** One entry in a task's step history (`TaskStep` model). `content` is opaque JSON. */
export interface EngineStep {
  id: string;
  taskId: string;
  stepIndex: number;
  type: EngineStepType;
  content: unknown;
  createdAt: string;
}

/** Full task returned by `GET /api/engine/tasks/:id` — list fields + prompt/result/steps. */
export interface EngineTaskDetail extends EngineTaskSummary {
  prompt: string;
  result: unknown;
  steps: EngineStep[];
}

/** One engine alert from the in-memory ring buffer (v0.5). */
export interface EngineAlert {
  at: string;
  type: string;
  taskId: string | null;
  detail: string | null;
}

/** `GET /api/engine/health` payload (v0.5 shape — the /health dashboard consumes this). */
export interface EngineHealth {
  /** Engine v0.1: "available" when Redis is reachable, "unavailable" when disabled. */
  engine: "available" | "unavailable";
  /** Human-readable reason when `engine` is "unavailable"; null when ready. */
  reason: string | null;
  /** Queue counters when enabled; null when the engine is disabled. */
  queue: {
    queue: string;
    waiting: number;
    active: number;
    failed: number;
    enabled: boolean;
    /** Engine v0.5 — durable failed-TASK count (dead-letter rows), distinct from BullMQ failed jobs. */
    failedTasks: number;
  } | null;
  /** Primary model verdict; `providers[]` present when more than one provider is configured. */
  model: {
    provider: string;
    model: string;
    reachable: boolean;
    error?: string;
    providers?: Array<{ provider: string; model: string; reachable: boolean; error?: string }>;
  };
  /** Engine v0.4 — scheduler poll loop state. */
  scheduler: {
    enabled: boolean;
    pollIntervalMs: number;
    lastSweepAt: string | null;
    dueCount: number;
    registeredEvents: number;
  };
  /** Engine v0.5 — stuck-task supervisor totals. */
  supervision: {
    enabled: boolean;
    pollIntervalMs: number;
    staleThresholdMs: number;
    lastSweepAt: string | null;
    staleFound: number;
    recovered: number;
    failedStalled: number;
  };
  /** Engine v0.5 — recent alert trail (ring buffer, resets on restart). */
  alerts: EngineAlert[];
  timestamp: string;
}

/** Body for `POST /api/engine/tasks`. `model` defaults server-side when omitted. */
export interface CreateTaskInput {
  title: string;
  prompt: string;
  model?: string;
  /** Engine v0.1 — per-task step ceiling (defaults to 20 server-side). */
  maxSteps?: number;
}

/** Discriminated result shared by the read calls — never throws. */
export type EngineResult<T> =
  | { state: "ok"; data: T }
  | { state: "not-found"; message: string }
  | { state: "forbidden"; message: string }
  | { state: "error"; message: string };

function authHeaders(token: string | null): HeadersInit | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

/** `GET /api/engine/tasks` — newest first, capped at 100 by the API. */
export async function fetchEngineTasks(token: string | null): Promise<EngineResult<EngineTaskSummary[]>> {
  if (!token) return { state: "forbidden", message: "You must be signed in to view engine tasks." };
  try {
    const res = await fetch(`${API_BASE}/engine/tasks`, { cache: "no-store", headers: authHeaders(token) });
    if (res.status === 401 || res.status === 403) {
      return { state: "forbidden", message: "You don't have permission to view engine tasks." };
    }
    if (!res.ok) return { state: "error", message: `The engine returned HTTP ${res.status}.` };
    const data = (await res.json()) as EngineTaskSummary[];
    return { state: "ok", data: Array.isArray(data) ? data : [] };
  } catch {
    return { state: "error", message: "Can't reach the Constellation API." };
  }
}

/** `GET /api/engine/tasks/:id` — detail + full step history. 404 → not-found. */
export async function fetchEngineTask(id: string, token: string | null): Promise<EngineResult<EngineTaskDetail>> {
  if (!token) return { state: "forbidden", message: "You must be signed in to view engine tasks." };
  try {
    const res = await fetch(`${API_BASE}/engine/tasks/${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: authHeaders(token),
    });
    if (res.status === 404) return { state: "not-found", message: "This task no longer exists on the server." };
    if (res.status === 401 || res.status === 403) {
      return { state: "forbidden", message: "You don't have permission to view engine tasks." };
    }
    if (!res.ok) return { state: "error", message: `The engine returned HTTP ${res.status}.` };
    return { state: "ok", data: (await res.json()) as EngineTaskDetail };
  } catch {
    return { state: "error", message: "Can't reach the Constellation API." };
  }
}

/** `POST /api/engine/tasks` — submit a task to the agent queue. */
export type SubmitTaskOutcome =
  | { ok: true; task: { id: string; status: string; title: string; createdAt: string } }
  | { ok: false; reason: "unauthenticated" | "forbidden" | "bad-args" | "unreachable" | "error"; message: string };

export async function submitEngineTask(input: CreateTaskInput, token: string | null): Promise<SubmitTaskOutcome> {
  if (!token) {
    return { ok: false, reason: "unauthenticated", message: "You must be signed in to submit tasks." };
  }
  try {
    const res = await fetch(`${API_BASE}/engine/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "forbidden", message: "You don't have permission to submit tasks." };
    }
    if (res.status === 400) {
      return { ok: false, reason: "bad-args", message: "The task was rejected — check the title and prompt." };
    }
    if (!res.ok) {
      return { ok: false, reason: "error", message: `Submission failed (HTTP ${res.status}).` };
    }
    const body = (await res.json()) as { id?: unknown; status?: unknown; title?: unknown; createdAt?: unknown };
    return {
      ok: true,
      task: {
        id: typeof body.id === "string" ? body.id : "",
        status: typeof body.status === "string" ? body.status : "queued",
        title: typeof body.title === "string" ? body.title : input.title,
        createdAt: typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString(),
      },
    };
  } catch {
    return { ok: false, reason: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/** `POST /api/engine/tasks/:id/cancel` — 400 (already terminal/missing) is a benign "nothing to do". */
export type CancelTaskOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "unauthenticated" | "forbidden" | "not-cancellable" | "unreachable" | "error"; message: string };

export async function cancelEngineTask(id: string, token: string | null): Promise<CancelTaskOutcome> {
  if (!token) {
    return { ok: false, reason: "unauthenticated", message: "You must be signed in to cancel tasks." };
  }
  try {
    const res = await fetch(`${API_BASE}/engine/tasks/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 400) {
      return {
        ok: false,
        reason: "not-cancellable",
        message: "Task can't be cancelled — it's already finished or no longer exists.",
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "forbidden", message: "You don't have permission to cancel tasks." };
    }
    if (!res.ok) return { ok: false, reason: "error", message: `Cancel failed (HTTP ${res.status}).` };
    return { ok: true, id };
  } catch {
    return { ok: false, reason: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/**
 * `POST /api/engine/tasks/:id/approve` — grant a PAUSED task's pending tool
 * call. The engine then executes the approved call exactly once and resumes
 * (see AgentWorkerService + engine.controller.ts). 400 = not paused / no
 * pending call, which we surface as a plain message (the list poll will
 * refresh the row to its real state).
 */
export type ApproveTaskOutcome =
  | { ok: true; id: string; approvedStepIndex?: number }
  | { ok: false; reason: "unauthenticated" | "forbidden" | "not-paused" | "unreachable" | "error"; message: string };

export async function approveEngineTask(id: string, token: string | null): Promise<ApproveTaskOutcome> {
  if (!token) {
    return { ok: false, reason: "unauthenticated", message: "You must be signed in to approve tasks." };
  }
  try {
    const res = await fetch(`${API_BASE}/engine/tasks/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 400) {
      return { ok: false, reason: "not-paused", message: "Task isn't paused — nothing to approve." };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "forbidden", message: "You don't have permission to approve tasks." };
    }
    if (!res.ok) return { ok: false, reason: "error", message: `Approve failed (HTTP ${res.status}).` };
    const body = (await res.json()) as { id?: unknown; approvedStepIndex?: unknown };
    return {
      ok: true,
      id: typeof body.id === "string" ? body.id : id,
      approvedStepIndex: typeof body.approvedStepIndex === "number" ? body.approvedStepIndex : undefined,
    };
  } catch {
    return { ok: false, reason: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/** `POST /api/engine/tasks/:id/reject` — fail a PAUSED task ("rejected by <user>"). */
export type RejectTaskOutcome =
  | { ok: true; id: string; reason?: string }
  | { ok: false; reason: "unauthenticated" | "forbidden" | "not-paused" | "unreachable" | "error"; message: string };

export async function rejectEngineTask(id: string, token: string | null): Promise<RejectTaskOutcome> {
  if (!token) {
    return { ok: false, reason: "unauthenticated", message: "You must be signed in to reject tasks." };
  }
  try {
    const res = await fetch(`${API_BASE}/engine/tasks/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 400) {
      return { ok: false, reason: "not-paused", message: "Task isn't paused — nothing to reject." };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "forbidden", message: "You don't have permission to reject tasks." };
    }
    if (!res.ok) return { ok: false, reason: "error", message: `Reject failed (HTTP ${res.status}).` };
    const body = (await res.json()) as { id?: unknown; reason?: unknown };
    return {
      ok: true,
      id: typeof body.id === "string" ? body.id : id,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    };
  } catch {
    return { ok: false, reason: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/** `GET /api/engine/health` — public; no token needed. */
export async function fetchEngineHealth(): Promise<EngineResult<EngineHealth>> {
  try {
    const res = await fetch(`${API_BASE}/engine/health`, { cache: "no-store" });
    if (!res.ok) return { state: "error", message: `Engine health returned HTTP ${res.status}.` };
    return { state: "ok", data: (await res.json()) as EngineHealth };
  } catch {
    return { state: "error", message: "Can't reach the Constellation API." };
  }
}

// ── Presentation helpers ─────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const CANCELLABLE_STATUSES = new Set(["queued", "running", "paused"]);

/** True for statuses that will not change any more on their own. */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** True for statuses a user may still cancel. */
export function isCancellableStatus(status: string): boolean {
  return CANCELLABLE_STATUSES.has(status);
}

/** Badge variant per status — matches the task spec's color scheme; unknown → neutral. */
export function statusVariant(
  status: string,
): "neutral" | "info" | "success" | "danger" | "warning" {
  const byStatus: Record<string, "neutral" | "info" | "success" | "danger" | "warning"> = {
    queued: "neutral", // gray
    running: "info", // blue
    completed: "success", // green
    failed: "danger", // red
    cancelled: "warning", // yellow
    paused: "warning", // suspended mid-run
  };
  return byStatus[status] ?? "neutral";
}

/** True when a tool_result step ended with `ok !== false` (the ToolResult envelope's own flag). */
export function stepSucceeded(step: EngineStep): boolean {
  const record = asRecord(step.content);
  return record?.ok !== false;
}

/**
 * A short human summary of a step's opaque `content`, shaped per step type
 * (the shapes the agent worker actually writes):
 *   thought      → { thought } | { raw }
 *   tool_call    → { plugin, tool, args }
 *   tool_result  → the ToolResult envelope ({ ok, result | error, ... })
 *   done         → { result }
 *   error        → { error }
 * Anything unexpected degrades to truncated JSON rather than throwing.
 */
export function stepSummaryText(step: EngineStep): string {
  const c = asRecord(step.content);
  switch (step.type) {
    case "thought": {
      const t = c?.thought ?? c?.raw;
      return typeof t === "string" && t.trim() ? t : fallbackJson(step.content);
    }
    case "tool_call": {
      const plugin = typeof c?.plugin === "string" ? c.plugin : "?";
      const tool = typeof c?.tool === "string" ? c.tool : "?";
      return `${plugin}.${tool}`;
    }
    case "pending_approval": {
      const plugin = typeof c?.plugin === "string" ? c.plugin : "?";
      const tool = typeof c?.tool === "string" ? c.tool : "?";
      return `awaiting approval: ${plugin}.${tool}`;
    }
    case "tool_result": {
      if (c?.ok === false) {
        const err = c?.error;
        return typeof err === "string" && err.trim() ? err : "tool call failed";
      }
      const result = c?.result;
      if (typeof result === "string" && result.trim()) return result;
      if (result !== undefined && result !== null) return fallbackJson(result);
      return "Tool call completed.";
    }
    case "done": {
      const r = c?.result;
      return typeof r === "string" && r.trim() ? r : fallbackJson(step.content);
    }
    case "error": {
      const e = c?.error;
      return typeof e === "string" && e.trim() ? e : fallbackJson(step.content);
    }
    default:
      return fallbackJson(step.content);
  }
}

/** Relative "created N ago" label for a task/step timestamp. */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Absolute timestamp label, defensive against malformed dates. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/** Coerce unknown JSON into a record when it is one; otherwise null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** JSON.stringify that never throws, truncated so a giant payload can't blow the layout. */
function fallbackJson(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (!text) return "—";
    return text.length > 240 ? `${text.slice(0, 240)}…` : text;
  } catch {
    return "—";
  }
}

/** Crews round (4.1): one node of the delegation tree. */
export interface DelegationTreeNode {
  id: string;
  title: string;
  status: string;
  provider: string | null;
  model: string | null;
  stepCount: number;
  totalTokens: number | null;
  costUSD: number | null;
  createdAt: string;
  completedAt: string | null;
  children: DelegationTreeNode[];
  /** Crews follow-up: descendants' cumulative usage (budget flow-down view). */
  childCount?: number;
  childrenTotalTokens?: number | null;
  childrenCostUSD?: number | null;
}

/** GET /engine/tasks/:id/tree — the full delegation tree under a task. */
export async function fetchTaskTree(token: string | null, id: string): Promise<DelegationTreeNode | null> {
  try {
    const res = await fetch(`${API_BASE}/engine/tasks/${encodeURIComponent(id)}/tree`, {
      cache: "no-store",
      headers: authHeaders(token),
    });
    if (!res.ok) return null;
    return (await res.json()) as DelegationTreeNode;
  } catch {
    return null;
  }
}

/** POST /engine/tasks/:id/delegate — spawn a sub-agent task under `id`. */
export async function delegateTask(
  token: string | null,
  id: string,
  input: { title: string; prompt: string; model?: string; maxSteps?: number },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/engine/tasks/${encodeURIComponent(id)}/delegate`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, error: body?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error" };
  }
}
