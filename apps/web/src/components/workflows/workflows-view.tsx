"use client";

import * as React from "react";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  GitBranch,
  GripVertical,
  Loader2,
  Play,
  Plus,
  Save,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  createWorkflow,
  deleteWorkflow,
  fetchWorkflow,
  fetchWorkflowRun,
  fetchWorkflows,
  runWorkflow,
  updateWorkflow,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowSummary,
} from "@/lib/workflows";

const newStepId = () => `s${Math.random().toString(36).slice(2, 8)}`;

const EMPTY_DEFINITION: WorkflowDefinition = {
  trigger: { type: "manual" },
  steps: [
    { id: newStepId(), kind: "agent", label: "Research", prompt: "Summarise the repository's plugin architecture." },
  ],
};

function toStepSummary(step: WorkflowStep): string {
  return step.kind === "agent" ? `agent · ${step.prompt.slice(0, 40)}` : `tool · ${step.plugin}.${step.tool}`;
}

/**
 * Phase 3.0 — visual workflow builder. Zero-dep canvas: step cards connected
 * by a vertical rail, native drag-to-reorder, inline editing, save/run and a
 * live run trail. Every call degrades to a toast, never a blank page.
 */
export function WorkflowsView() {
  const { token } = useAuth();
  const [workflows, setWorkflows] = React.useState<WorkflowSummary[] | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<{ name: string; description: string; definition: WorkflowDefinition } | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [runs, setRuns] = React.useState<WorkflowRun[]>([]);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);

  const refresh = React.useCallback(async () => {
    const res = await fetchWorkflows(token);
    if (res.state === "ok") setWorkflows(res.data);
  }, [token]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const openWorkflow = async (id: string) => {
    const res = await fetchWorkflow(id, token);
    if (res.state !== "ok") {
      toast.error("Couldn't load workflow", { description: res.message });
      return;
    }
    setSelectedId(id);
    setDraft({
      name: res.data.name,
      description: res.data.description ?? "",
      definition: res.data.definition,
    });
    setRuns(res.data.runs ?? []);
    setDirty(false);
  };

  const newWorkflow = () => {
    setSelectedId(null);
    setDraft({
      name: "Untitled workflow",
      description: "",
      definition: JSON.parse(JSON.stringify(EMPTY_DEFINITION)),
    });
    setRuns([]);
    setDirty(true);
  };

  const patchDraft = (patch: Partial<typeof draft>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };

  const patchStep = (id: string, patch: Partial<WorkflowStep>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      definition: {
        ...draft.definition,
        steps: draft.definition.steps.map((s) => (s.id === id ? ({ ...s, ...patch } as WorkflowStep) : s)),
      },
    });
    setDirty(true);
  };

  const addStep = (kind: "agent" | "tool") => {
    if (!draft) return;
    const step: WorkflowStep =
      kind === "agent"
        ? { id: newStepId(), kind, label: "Agent step", prompt: "Describe what the agent should do." }
        : { id: newStepId(), kind, label: "Tool step", plugin: "graphify", tool: "graph.query", args: { question: "{{steps.s1.result}}" } };
    setDraft({ ...draft, definition: { ...draft.definition, steps: [...draft.definition.steps, step] } });
    setDirty(true);
  };

  const removeStep = (id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      definition: { ...draft.definition, steps: draft.definition.steps.filter((s) => s.id !== id) },
    });
    setDirty(true);
  };

  const moveStep = (from: number, to: number) => {
    if (!draft) return;
    const steps = [...draft.definition.steps];
    const [moved] = steps.splice(from, 1);
    if (!moved) return;
    steps.splice(to, 0, moved);
    setDraft({ ...draft, definition: { ...draft.definition, steps } });
    setDirty(true);
  };

  const handleDrop = (toIndex: number) => {
    if (dragIndex === null) return;
    const from = dragIndex;
    setDragIndex(null);
    if (from === toIndex) return;
    moveStep(from, from < toIndex ? toIndex - 1 : toIndex);
  };

  const save = async () => {
    if (!draft || !token) return;
    if (draft.definition.steps.length === 0) {
      toast.error("Add at least one step before saving.");
      return;
    }
    setSaving(true);
    const payload = { name: draft.name, description: draft.description || undefined, definition: draft.definition };
    const res = selectedId ? await updateWorkflow(selectedId, payload, token) : await createWorkflow(payload, token);
    if (res.ok) {
      toast.success(selectedId ? "Workflow updated" : "Workflow created");
      setSelectedId(res.id);
      setDirty(false);
      await refresh();
      if (res.id) await openWorkflow(res.id);
    } else {
      toast.error("Save failed", { description: res.message });
    }
    setSaving(false);
  };

  const run = async () => {
    if (!selectedId || !token) return;
    if (dirty) {
      toast.info("Save the workflow before running it.");
      return;
    }
    setRunning(true);
    const res = await runWorkflow(selectedId, token);
    if (!res.ok) {
      toast.error("Run failed to start", { description: res.message });
      setRunning(false);
      return;
    }
    toast.success("Workflow run started", { description: "Watching it live…" });
    // Poll the run until it reaches a terminal state.
    const poll = async () => {
      for (let i = 0; i < 120; i++) {
        const runRes = await fetchWorkflowRun(selectedId, res.id, token);
        if (runRes.state === "ok") {
          setRuns((prev) => {
            const exists = prev.some((r) => r.id === runRes.data.id);
            return exists ? prev.map((r) => (r.id === runRes.data.id ? runRes.data : r)) : [runRes.data, ...prev];
          });
          if (runRes.data.status !== "running") {
            toast.success(runRes.data.status === "completed" ? "Workflow completed" : "Workflow failed");
            setRunning(false);
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      setRunning(false);
    };
    void poll();
  };

  const remove = async (id: string) => {
    const res = await deleteWorkflow(id, token);
    if (res.ok) {
      toast.info("Workflow deleted");
      if (selectedId === id) {
        setSelectedId(null);
        setDraft(null);
        setRuns([]);
      }
      await refresh();
    } else {
      toast.error("Delete failed", { description: res.message });
    }
  };

  const definitionForRun: WorkflowDefinition | null = draft?.definition ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* ── Workflow list ─────────────────────────────────────────────── */}
      <Card className="h-fit lg:col-span-1">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Workflows</CardTitle>
          <Button type="button" size="sm" onClick={newWorkflow} disabled={!token}>
            <Plus className="size-3.5" /> New
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {workflows === null ? (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">Loading…</p>
          ) : workflows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              No workflows yet — create your first one.
            </p>
          ) : (
            <ul className="space-y-1">
              {workflows.map((w) => (
                <li key={w.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void openWorkflow(w.id)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      selectedId === w.id
                        ? "border-accent/60 bg-accent/10 text-accent"
                        : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700"
                    }`}
                  >
                    <span className="block truncate font-medium">{w.name}</span>
                    <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
                      {w.definition.steps.length} step{w.definition.steps.length === 1 ? "" : "s"} · {w.definition.trigger.type}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-neutral-400 hover:text-rose-500"
                    onClick={() => void remove(w.id)}
                    aria-label={`Delete ${w.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Builder canvas ────────────────────────────────────────────── */}
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="size-4 text-accent" />
              {draft ? (
                <input
                  value={draft.name}
                  onChange={(e) => patchDraft({ name: e.target.value })}
                  className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold focus-visible:border-neutral-300 focus-visible:outline-none dark:focus-visible:border-neutral-700"
                  aria-label="Workflow name"
                />
              ) : (
                "Builder"
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              {dirty ? "Unsaved changes" : "Steps run top-to-bottom; earlier results pipe into later steps."}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void save()} disabled={!draft || !token || saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {selectedId ? "Save" : "Create"}
            </Button>
            <Button type="button" size="sm" onClick={() => void run()} disabled={!selectedId || dirty || running || !token}>
              {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              Run
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {!draft ? (
            <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              Select a workflow from the list or create a new one to open the builder.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Trigger node */}
              <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-accent">
                  <Zap className="size-3.5" /> Trigger
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {(["manual", "cron", "event"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        patchDraft({
                          definition: { ...draft.definition, trigger: { type: t, ...(t === "cron" ? { cron: "0 9 * * *" } : t === "event" ? { event: "engine.task.completed" } : {}) } },
                        })
                      }
                      className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                        draft.definition.trigger.type === t
                          ? "border-accent/60 bg-accent/10 text-accent"
                          : "border-neutral-200 text-neutral-500 hover:border-neutral-300 dark:border-neutral-800 dark:text-neutral-400"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                  {draft.definition.trigger.type === "cron" ? (
                    <Input
                      value={draft.definition.trigger.cron ?? ""}
                      onChange={(e) =>
                        patchDraft({ definition: { ...draft.definition, trigger: { type: "cron", cron: e.target.value } } })
                      }
                      className="w-40"
                      aria-label="Cron expression"
                    />
                  ) : null}
                  {draft.definition.trigger.type === "event" ? (
                    <Input
                      value={draft.definition.trigger.event ?? ""}
                      onChange={(e) =>
                        patchDraft({ definition: { ...draft.definition, trigger: { type: "event", event: e.target.value } } })
                      }
                      className="w-48"
                      aria-label="Event name"
                    />
                  ) : null}
                  {draft.definition.trigger.type !== "manual" ? (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">
                      scheduled triggering lands with the scheduler wiring round — the definition is saved as-is
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Step rail */}
              <div className="relative">
                <div className="absolute bottom-4 left-[11px] top-4 w-px bg-neutral-200 dark:bg-neutral-800" aria-hidden="true" />
                <ol className="space-y-3">
                  {draft.definition.steps.map((step, index) => (
                    <li
                      key={step.id}
                      draggable
                      onDragStart={() => setDragIndex(index)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(index)}
                      className={`relative rounded-xl border bg-white p-3 transition-colors dark:bg-neutral-900 ${
                        dragIndex === index ? "opacity-40" : "border-neutral-200 dark:border-neutral-800"
                      }`}
                    >
                      <div className="absolute -left-1 top-4 flex size-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-xs font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
                        {index + 1}
                      </div>
                      <div className="mb-2 flex items-center gap-2">
                        <GripVertical className="size-4 cursor-grab text-neutral-400" aria-label="Drag to reorder" />
                        <Badge variant={step.kind === "agent" ? "info" : "accent"}>
                          {step.kind === "agent" ? <Bot className="size-3" /> : <Wrench className="size-3" />}
                          {step.kind === "agent" ? "Agent" : "Tool"}
                        </Badge>
                        <Input
                          value={step.label ?? ""}
                          onChange={(e) => patchStep(step.id, { label: e.target.value })}
                          className="h-8 max-w-52"
                          placeholder="Step label"
                          aria-label="Step label"
                        />
                        <span className="ml-auto flex items-center gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={index === 0}
                            onClick={() => moveStep(index, index - 1)}
                            aria-label="Move up"
                          >
                            <ChevronUp className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={index === draft.definition.steps.length - 1}
                            onClick={() => moveStep(index, index + 2)}
                            aria-label="Move down"
                          >
                            <ChevronDown className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-neutral-400 hover:text-rose-500"
                            onClick={() => removeStep(step.id)}
                            aria-label="Remove step"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </span>
                      </div>

                      {step.kind === "agent" ? (
                        <div className="space-y-2">
                          <textarea
                            value={step.prompt}
                            onChange={(e) => patchStep(step.id, { prompt: e.target.value })}
                            rows={3}
                            className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-800 dark:bg-neutral-950"
                            aria-label="Agent prompt"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Input
                              value={step.model ?? ""}
                              onChange={(e) => patchStep(step.id, { model: e.target.value || undefined })}
                              className="h-8 w-48"
                              placeholder="model (default)"
                              aria-label="Model"
                            />
                            <Input
                              type="number"
                              min={1}
                              max={50}
                              value={step.maxSteps ?? 20}
                              onChange={(e) => patchStep(step.id, { maxSteps: Number(e.target.value) || undefined })}
                              className="h-8 w-24"
                              placeholder="max steps"
                              aria-label="Max steps"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            value={step.plugin}
                            onChange={(e) => patchStep(step.id, { plugin: e.target.value })}
                            className="h-8 w-36"
                            placeholder="plugin id"
                            aria-label="Plugin id"
                          />
                          <span className="text-neutral-400">.</span>
                          <Input
                            value={step.tool}
                            onChange={(e) => patchStep(step.id, { tool: e.target.value })}
                            className="h-8 w-44"
                            placeholder="tool name"
                            aria-label="Tool name"
                          />
                          <Input
                            value={step.args ? JSON.stringify(step.args) : ""}
                            onChange={(e) => {
                              try {
                                patchStep(step.id, { args: JSON.parse(e.target.value) as Record<string, unknown> });
                              } catch {
                                /* keep the last valid args while typing */
                              }
                            }}
                            className="h-8 min-w-56 flex-1 font-mono text-xs"
                            placeholder='{"question": "{{steps.s1.result}}"}'
                            aria-label="Tool args JSON"
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              {/* Add-step palette */}
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => addStep("agent")}>
                  <Plus className="size-3.5" /> Agent step
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => addStep("tool")}>
                  <Plus className="size-3.5" /> Tool step
                </Button>
                <span className="text-xs text-neutral-400 dark:text-neutral-500">
                  {draft.definition.steps.length} step{draft.definition.steps.length === 1 ? "" : "s"} · drag cards to reorder
                </span>
              </div>

              {/* Runs trail */}
              {runs.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                    Recent runs
                  </p>
                  <ul className="space-y-2">
                    {runs.map((run) => (
                      <RunRow key={run.id} run={run} definition={definitionForRun} />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RunRow({ run, definition }: { run: WorkflowRun; definition: WorkflowDefinition | null }) {
  return (
    <li className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={run.status === "completed" ? "success" : run.status === "running" ? "info" : "danger"}>
          {run.status === "running" ? <Loader2 className="size-3 animate-spin" /> : null}
          {run.status}
        </Badge>
        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          {run.createdAt ? new Date(run.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—"}
          {run.completedAt ? ` · ${Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s` : ""}
        </span>
        {run.error ? <span className="text-xs text-rose-500">{run.error}</span> : null}
      </div>
      {run.stepsResult && run.stepsResult.length > 0 ? (
        <ol className="mt-2 space-y-1">
          {run.stepsResult.map((s, i) => (
            <li key={`${s.id}-${i}`} className="flex items-center gap-2 text-xs">
              <span className="inline-flex size-4 items-center justify-center rounded-full bg-neutral-100 text-[10px] text-neutral-500 dark:bg-neutral-800">
                {i + 1}
              </span>
              <Badge variant={s.ok ? "success" : "danger"}>{s.ok ? "ok" : "failed"}</Badge>
              <span className="text-neutral-600 dark:text-neutral-300">
                {s.label ?? s.id} · {summaryOf(s)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-xs text-neutral-400">No steps recorded yet — the run is still starting.</p>
      )}
      {definition ? (
        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
          {definition.steps.map(toStepSummary).join(" → ")}
        </p>
      ) : null}
    </li>
  );
}

function summaryOf(s: { ok: boolean; result?: unknown; error?: string }): string {
  if (!s.ok) return s.error ?? "failed";
  if (typeof s.result === "string") return s.result.slice(0, 80);
  try {
    const text = JSON.stringify(s.result);
    return text ? text.slice(0, 80) : "done";
  } catch {
    return "done";
  }
}
