"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Flag,
  ListChecks,
  Loader2,
  Lock,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Wrench,
  XCircle,
} from "lucide-react";

import {
  approveEngineTask,
  cancelEngineTask,
  fetchEngineHealth,
  fetchEngineTask,
  fetchEngineTasks,
  formatRelativeTime,
  formatWhen,
  isCancellableStatus,
  isTerminalStatus,
  rejectEngineTask,
  stepSucceeded,
  stepSummaryText,
  submitEngineTask,
  type EngineHealth,
  type EngineStep,
  type EngineTaskDetail,
  type EngineTaskSummary,
} from "@/lib/engine";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DelegationSection } from "./delegation-section";
import { StatusBadge } from "./status-badge";
import { Reveal } from "@/components/motion/reveal";
import { toast } from "sonner";

const POLL_MS = 5000;

/** Phase 3.0 — status filter tabs ("" = All). */
const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "All" },
  { key: "queued", label: "Queued" },
  { key: "running", label: "Running" },
  { key: "paused", label: "Paused" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
  { key: "cancelled", label: "Cancelled" },
];

/**
 * The Engine page.
 *
 * A real ops panel over `apps/api/src/core/engine`: engine health at the top
 * (queue waiting/active/failed + model router reachability), a task
 * submission form, and a task table that auto-refreshes every 5s. Clicking a
 * row opens a detail dialog with the full step history; running/queued tasks
 * can be cancelled. Every surface degrades gracefully when the API is down —
 * the list keeps its last good snapshot, and the form/detail surfaces their
 * own errors instead of throwing.
 */
export function EngineView() {
  const { token, user } = useAuth();

  // ── Live data ───────────────────────────────────────────────────────────
  const [tasks, setTasks] = React.useState<EngineTaskSummary[] | null>(null);
  const [tasksError, setTasksError] = React.useState(false);
  const [health, setHealth] = React.useState<EngineHealth | null>(null);
  const [healthError, setHealthError] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // ── Submission form ─────────────────────────────────────────────────────
  const [title, setTitle] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [model, setModel] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [formSuccess, setFormSuccess] = React.useState<string | null>(null);

  // ── Detail dialog ───────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<EngineTaskDetail | null>(null);
  const [detailState, setDetailState] = React.useState<"loading" | "error" | "not-found" | "idle">("loading");
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);
  const [cancelError, setCancelError] = React.useState<string | null>(null);
  // ── Human-in-the-loop decisions (approve / reject a paused task) ────────
  const [decidingId, setDecidingId] = React.useState<string | null>(null);
  const [decisionError, setDecisionError] = React.useState<string | null>(null);

  // Phase 3.0 — status filter tabs ("" = all) + re-run in-flight id.
  const [filter, setFilter] = React.useState("");
  const [rerunningId, setRerunningId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Live poll: task list + engine health every 5s. On failure we keep the
  // last good snapshot and flip the error flag (the render decides what to
  // show); the interval never throws.
  React.useEffect(() => {
    let active = true;
    const tick = async () => {
      if (!token) return;
      const [tasksRes, healthRes] = await Promise.all([fetchEngineTasks(token), fetchEngineHealth()]);
      if (!active) return;
      if (tasksRes.state === "ok") {
        setTasks(tasksRes.data);
        setTasksError(false);
      } else {
        setTasksError(true);
      }
      if (healthRes.state === "ok") {
        setHealth(healthRes.data);
        setHealthError(false);
      } else {
        setHealthError(true);
      }
    };
    void tick();
    const id = setInterval(() => {
      if (active) void tick();
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [token, refreshKey]);

  // Detail fetch: once on open, then keep polling while the task is still
  // active so the step log grows live. Terminal tasks stop polling.
  React.useEffect(() => {
    if (!selectedId || !token) return;
    let active = true;
    let stopped = false;
    const load = async () => {
      if (stopped) return;
      const res = await fetchEngineTask(selectedId, token);
      if (!active) return;
      if (res.state === "ok") {
        setDetail(res.data);
        setDetailState("idle");
        if (isTerminalStatus(res.data.status)) stopped = true;
      } else if (res.state === "not-found") {
        setDetailState("not-found");
        stopped = true;
      } else {
        // Transient API error — keep polling so the drawer recovers on its own.
        setDetailState("error");
      }
    };
    void load();
    // Phase 3.0 — live streaming: poll the OPEN task at 2s (vs the 5s list
    // cadence) so Think → Act → Observe steps appear as they happen.
    const id = setInterval(() => {
      if (active && !stopped) void load();
    }, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [selectedId, token, refreshKey]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedTitle || !trimmedPrompt || submitting) return;
    setSubmitting(true);
    setFormError(null);
    setFormSuccess(null);
    const res = await submitEngineTask(
      { title: trimmedTitle, prompt: trimmedPrompt, model: model.trim() || undefined },
      token,
    );
    setSubmitting(false);
    if (res.ok) {
      setTitle("");
      setPrompt("");
      setModel("");
      setFormSuccess(`Task "${res.task.title}" queued.`);
      toast.success(`Task queued`, { description: `"${res.task.title}" is now in the engine queue.` });
      setRefreshKey((k) => k + 1);
      setSelectedId(res.task.id); // open the drawer so the user watches it run
    } else {
      setFormError(res.message);
      toast.error("Couldn't queue task", { description: res.message });
    }
  }

  async function handleCancel(taskId: string) {
    if (cancellingId) return;
    setCancellingId(taskId);
    setCancelError(null);
    const res = await cancelEngineTask(taskId, token);
    setCancellingId(null);
    setRefreshKey((k) => k + 1); // list + (if open) drawer refetch immediately
    if (!res.ok && res.reason !== "not-cancellable") {
      setCancelError(res.message);
      toast.error("Couldn't cancel task", { description: res.message });
    } else if (res.ok) {
      toast.info("Task cancelled");
    }
  }

  /**
   * Phase 3.0 — Re-run a finished task: fetch its detail (the list rows omit
   * the prompt), then re-submit the SAME title/prompt/model as a fresh task.
   * No new API surface — composition of the existing detail + submit calls.
   */
  async function handleRerun(task: EngineTaskSummary) {
    if (rerunningId || !token) return;
    setRerunningId(task.id);
    setFormError(null);
    setFormSuccess(null);
    const detailRes = await fetchEngineTask(task.id, token);
    if (detailRes.state !== "ok") {
      setFormError(detailRes.message);
      setRerunningId(null);
      return;
    }
    const d = detailRes.data;
    const out = await submitEngineTask(
      { title: d.title, prompt: d.prompt, model: d.model ?? undefined },
      token,
    );
    if (out.ok) {
      setFormSuccess(`Re-queued “${out.task.title}” — new run ${out.task.id.slice(0, 8)}…`);
      setRefreshKey((k) => k + 1);
    } else {
      setFormError(out.message);
    }
    setRerunningId(null);
  }

  // Phase 3.0 — derived values for the filter tabs + model picker.
  const filteredTasks =
    tasks === null ? null : !filter ? tasks : tasks.filter((t) => t.status === filter);
  const availableModels = React.useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; label: string }> = [];
    for (const p of health?.model.providers ?? []) {
      if (p.model && !seen.has(p.model)) {
        seen.add(p.model);
        out.push({ id: p.model, label: `${p.model} — ${p.provider}${p.reachable ? "" : " (down)"}` });
      }
    }
    return out;
  }, [health]);

  const copyResult = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be denied in embedded contexts — the button just does
      // nothing visible rather than throwing.
    }
  };

  /** Approve a paused task's pending tool call (executes it exactly once). */
  async function handleApprove(taskId: string) {
    if (decidingId) return;
    setDecidingId(taskId);
    setDecisionError(null);
    const res = await approveEngineTask(taskId, token);
    setDecidingId(null);
    setRefreshKey((k) => k + 1);
    if (!res.ok) {
      setDecisionError(res.message);
      toast.error("Approval failed", { description: res.message });
    } else {
      toast.success("Tool call approved", { description: "It will execute exactly once." });
    }
  }

  /** Reject a paused task's pending tool call (fails the task). */
  async function handleReject(taskId: string) {
    if (decidingId) return;
    setDecidingId(taskId);
    setDecisionError(null);
    const res = await rejectEngineTask(taskId, token);
    setDecidingId(null);
    setRefreshKey((k) => k + 1);
    if (!res.ok) {
      setDecisionError(res.message);
      toast.error("Rejection failed", { description: res.message });
    } else {
      toast.info("Tool call rejected", { description: "The task will fail." });
    }
  }

  const openTask = (id: string) => {
    setDetail(null);
    setDetailState("loading");
    setCancelError(null);
    setSelectedId(id);
  };

  return (
    <Reveal className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            <Cpu className="size-6 text-accent" />
            Engine
          </h1>
          <p className="mt-2 max-w-2xl text-neutral-500 dark:text-neutral-400">
            The agentic task runtime: submit a task, watch the agent work through it step by
            step, and inspect the full history of every run.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </header>

      <HealthStrip health={health} error={healthError} />

      {!token ? (
        <div className="mt-6 rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          You need to be signed in to submit or view engine tasks. The engine health above is
          public; the rest of this page requires a session.
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* ── Submission form ─────────────────────────────────────────────── */}
        <Card className="h-fit lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Submit a task</CardTitle>
            <CardDescription>
              The agent works through it step by step using the available plugin tools.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="engine-task-title"
                  className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Title
                </label>
                <Input
                  id="engine-task-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Summarise the plugin loader"
                  disabled={!token || submitting}
                  required
                  maxLength={120}
                />
              </div>
              <div>
                <label
                  htmlFor="engine-task-prompt"
                  className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Prompt
                </label>
                <textarea
                  id="engine-task-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  placeholder="What should the agent accomplish?"
                  disabled={!token || submitting}
                  required
                  className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900"
                />
              </div>
              <div>
                <label
                  htmlFor="engine-task-model"
                  className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Model <span className="font-normal text-neutral-400">(optional)</span>
                </label>
                {/* Phase 3.0 — picker fed by the health payload's provider list;
                    free text still works (datalist = suggestions, not a lock). */}
                <Input
                  id="engine-task-model"
                  list="engine-models"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={
                    availableModels.length > 0 ? availableModels[0]?.id ?? "default" : "default"
                  }
                  disabled={!token || submitting}
                  maxLength={120}
                />
                {availableModels.length > 0 ? (
                  <datalist id="engine-models">
                    {availableModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </datalist>
                ) : null}
              </div>

              {formError ? (
                <p
                  role="alert"
                  className="flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {formError}
                </p>
              ) : null}
              {formSuccess ? (
                <p
                  role="status"
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  {formSuccess}
                </p>
              ) : null}

              <Button type="submit" disabled={!token || submitting} aria-busy={submitting} className="w-full">
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {submitting ? "Queuing…" : "Submit task"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ── Task list ───────────────────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <ListChecks className="size-4" />
            </span>
            <div>
              <CardTitle className="text-base">Tasks</CardTitle>
              <CardDescription>Auto-refreshes every 5 seconds.</CardDescription>
            </div>
            <Badge variant="neutral" className="ml-auto">
              {tasks?.length ?? 0} shown
            </Badge>
          </CardHeader>
          <CardContent className="pt-0">
            {!token ? (
              <EmptyPanel icon={<Lock className="size-5" />} text="Sign in to view engine tasks." />
            ) : tasks === null && !tasksError ? (
              <EmptyPanel icon={<Loader2 className="size-5 animate-spin" />} text="Loading tasks…" />
            ) : tasks === null ? (
              <EmptyPanel
                icon={<AlertTriangle className="size-5" />}
                text="Couldn't reach the engine. The API may be starting up — this refreshes automatically."
              />
            ) : tasks.length === 0 ? (
              <EmptyPanel
                icon={<ListChecks className="size-5" />}
                text="No tasks yet. Submit one on the left to get started."
              />
            ) : (
              <>
                {tasksError ? (
                  <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">
                    Connection lost — showing the last snapshot; retrying automatically.
                  </p>
                ) : null}
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  {STATUS_FILTERS.map((f) => {
                    const count =
                      f.key === "" ? tasks.length : tasks.filter((t) => t.status === f.key).length;
                    const active = filter === f.key;
                    return (
                      <button
                        key={f.key || "all"}
                        type="button"
                        onClick={() => setFilter(f.key)}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          active
                            ? "border-accent/60 bg-accent/10 text-accent"
                            : "border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-700 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-neutral-200"
                        }`}
                      >
                        {f.label}
                        <span className="tabular-nums opacity-70">{count}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                        <th className="py-2 pr-4 font-medium">Task</th>
                        <th className="py-2 pr-4 font-medium">Status</th>
                        <th className="py-2 pr-4 font-medium">Steps</th>
                        <th className="py-2 pr-4 font-medium">Created</th>
                        <th className="py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks?.map((task) => (
                        <tr
                          key={task.id}
                          onClick={() => openTask(task.id)}
                          className="cursor-pointer border-b border-neutral-100 transition-colors hover:bg-neutral-50 dark:border-neutral-800/60 dark:hover:bg-neutral-800/30"
                        >
                          <td className="max-w-[260px] py-2.5 pr-4">
                            <button
                              type="button"
                              onClick={() => openTask(task.id)}
                              className="block max-w-full truncate rounded text-left font-medium text-neutral-800 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-200"
                            >
                              {task.title}
                            </button>
                          </td>
                          <td className="py-2.5 pr-4">
                            <StatusBadge status={task.status} />
                          </td>
                          <td className="py-2.5 pr-4 tabular-nums text-neutral-600 dark:text-neutral-300">
                            {task.stepCount}/{task.maxSteps}
                          </td>
                          <td className="py-2.5 pr-4 text-neutral-500 dark:text-neutral-400">
                            {formatRelativeTime(task.createdAt)}
                          </td>
                          <td className="py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {task.status === "paused" ? (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleApprove(task.id);
                                    }}
                                    disabled={decidingId === task.id || !token}
                                    title="Approve the pending tool call — it will execute exactly once"
                                  >
                                    {decidingId === task.id ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="size-3.5" />
                                    )}
                                    Approve
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleReject(task.id);
                                    }}
                                    disabled={decidingId === task.id || !token}
                                    title="Reject the pending tool call — the task fails"
                                  >
                                    <XCircle className="size-3.5" />
                                    Reject
                                  </Button>
                                </>
                              ) : null}
                              {isCancellableStatus(task.status) ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleCancel(task.id);
                                  }}
                                  disabled={cancellingId === task.id || !token}
                                >
                                  {cancellingId === task.id ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <XCircle className="size-3.5" />
                                  )}
                                  Cancel
                                </Button>
                              ) : null}
                              {isTerminalStatus(task.status) ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleRerun(task);
                                  }}
                                  disabled={rerunningId === task.id || !token}
                                  title="Re-run this task with the same title, prompt and model"
                                >
                                  {rerunningId === task.id ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <RotateCcw className="size-3.5" />
                                  )}
                                  Re-run
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Detail dialog ─────────────────────────────────────────────────── */}
      <Dialog open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-2xl">
          {detailState === "loading" && !detail ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500 dark:text-neutral-400">
              <Loader2 className="size-4 animate-spin" /> Loading task…
            </div>
          ) : detailState === "not-found" ? (
            <div className="py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
              This task no longer exists on the server.
            </div>
          ) : detailState === "error" && !detail ? (
            <div className="py-16 text-center text-sm text-rose-600 dark:text-rose-400">
              Couldn&apos;t load this task. The API may be starting up.
            </div>
          ) : detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">{detail.title}</DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <StatusBadge status={detail.status} />
                  <span>created {formatRelativeTime(detail.createdAt)}</span>
                  {detail.model ? <span>· model {detail.model}</span> : null}
                  {detail.provider ? <span>· {detail.provider}</span> : null}
                  <span>
                    · {detail.stepCount}/{detail.maxSteps} steps
                  </span>
                  <span>· started {formatWhen(detail.startedAt)}</span>
                  <span>· finished {formatWhen(detail.completedAt)}</span>
                  {!isTerminalStatus(detail.status) ? (
                    <span className="inline-flex items-center gap-1 text-accent">
                      <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                      live
                    </span>
                  ) : null}
                </DialogDescription>
              </DialogHeader>

              {detail.error ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
                  <span className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {detail.error}
                  </span>
                </div>
              ) : null}

              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                  Prompt
                </p>
                <p className="whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300">
                  {detail.prompt}
                </p>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                  Step history{detail.steps.length > 0 ? ` (${detail.steps.length})` : ""}
                </p>
                {detail.steps.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                    No steps recorded yet — the worker hasn&apos;t started on this task.
                  </p>
                ) : (
                  <ol className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                    {detail.steps.map((step) => (
                      <StepRow key={step.id} step={step} />
                    ))}
                  </ol>
                )}
              </div>

              {detail.status === "completed" && detail.result !== null && detail.result !== undefined ? (
                <div>
                  <p className="mb-1 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                    <span>Result</span>
                    <button
                      type="button"
                      onClick={() =>
                        void copyResult(
                          typeof detail.result === "string"
                            ? detail.result
                            : JSON.stringify(detail.result, null, 2),
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-neutral-200 px-1.5 py-0.5 font-normal normal-case tracking-normal text-neutral-500 transition-colors hover:border-neutral-300 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-neutral-200"
                    >
                      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </p>
                  <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
                    {typeof detail.result === "string"
                      ? detail.result
                      : JSON.stringify(detail.result, null, 2)}
                  </pre>
                </div>
              ) : null}

              {cancelError ? (
                <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                  {cancelError}
                </p>
              ) : null}

              {decisionError ? (
                <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                  {decisionError}
                </p>
              ) : null}

              <div className="mt-2 flex items-center justify-end gap-2">
                {detail.status === "paused" ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleApprove(detail.id)}
                      disabled={decidingId !== null}
                      title="Approve the pending tool call — it will execute exactly once"
                    >
                      {decidingId === detail.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5" />
                      )}
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleReject(detail.id)}
                      disabled={decidingId !== null}
                      title="Reject the pending tool call — the task fails"
                    >
                      <XCircle className="size-3.5" />
                      Reject
                    </Button>
                  </>
                ) : null}
                {isCancellableStatus(detail.status) ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleCancel(detail.id)}
                    disabled={cancellingId !== null}
                  >
                    {cancellingId === detail.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <XCircle className="size-3.5" />
                    )}
                    Cancel task
                  </Button>
                ) : null}
              </div>

              {/* Crews round (4.1): delegation tree + delegate form. */}
              <DelegationSection
                token={token}
                taskId={detail.id}
                canManage={user?.id != null && user.id === detail.actorId}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Reveal>
  );
}

function HealthStrip({ health, error }: { health: EngineHealth | null; error: boolean }) {
  const queueDisabled = health !== null && health.queue === null;
  const queueCount = (key: "waiting" | "active" | "failed") =>
    health && health.queue ? String(health.queue[key]) : "—";

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<ListChecks className="size-4" />}
          label="Waiting"
          value={queueCount("waiting")}
        />
        <StatCard icon={<Play className="size-4" />} label="Active" value={queueCount("active")} />
        <StatCard
          icon={<AlertTriangle className="size-4" />}
          label="Failed"
          value={queueCount("failed")}
        />
        <StatCard
          icon={<Activity className="size-4" />}
          label="Model router"
          value={health ? health.model.model : "—"}
          badge={
            health ? (
              health.model.reachable ? (
                <Badge variant="success">reachable</Badge>
              ) : (
                <Badge variant="danger">unreachable</Badge>
              )
            ) : undefined
          }
          sub={
            health && !health.model.reachable
              ? health.model.error
              : health
                ? `${health.model.provider} · ${health.model.model}`
                : undefined
          }
        />
      </div>
      {queueDisabled && health ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500">
          <AlertTriangle className="size-3.5" />
          Engine is unavailable — the queue backend (Redis) is down or unset:
          {health.reason ? ` ${health.reason}` : " no reason given."}
        </p>
      ) : null}
      {error && !health ? (
        <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
          Engine health unavailable — the API may be starting up.
        </p>
      ) : null}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  badge,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge?: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
        <span className="text-neutral-400">{icon}</span>
        {label}
        {badge ? <span className="ml-auto">{badge}</span> : null}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">{value}</div>
      {sub ? (
        <div className="mt-1 truncate text-xs text-neutral-400 dark:text-neutral-500" title={sub}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function StepRow({ step }: { step: EngineStep }) {
  return (
    <li className="flex gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <span className="mt-0.5 shrink-0">
        <StepIcon step={step} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {step.type.replace("_", " ")}
          </span>
          <span className="text-xs text-neutral-400 dark:text-neutral-500">step {step.stepIndex}</span>
          <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500">
            {formatRelativeTime(step.createdAt)}
          </span>
        </div>
        <p className="mt-1 line-clamp-3 break-words text-sm text-neutral-700 dark:text-neutral-300">
          {stepSummaryText(step)}
        </p>
      </div>
    </li>
  );
}

function StepIcon({ step }: { step: EngineStep }) {
  switch (step.type) {
    case "thought":
      return <MessageSquare className="size-3.5 text-neutral-400" />;
    case "tool_call":
      return <Wrench className="size-3.5 text-sky-500" />;
    case "tool_result":
      return stepSucceeded(step) ? (
        <CheckCircle2 className="size-3.5 text-emerald-500" />
      ) : (
        <XCircle className="size-3.5 text-rose-500" />
      );
    case "done":
      return <Flag className="size-3.5 text-emerald-500" />;
    default:
      return <AlertTriangle className="size-3.5 text-rose-500" />;
  }
}

function EmptyPanel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
      <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        {icon}
      </span>
      {text}
    </div>
  );
}
