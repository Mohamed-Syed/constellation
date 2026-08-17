"use client";

import * as React from "react";
import { BarChart3, CheckCircle2, Clock, Coins, Copy, FileText, Loader2, Play, Sparkles, XCircle } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Reveal } from "@/components/motion/reveal";
import { scoreQuality, type QualityScore } from "@/lib/compare-quality";
import {
  fetchEngineHealth,
  fetchEngineTask,
  isTerminalStatus,
  submitEngineTask,
  type EngineHealth,
  type EngineTaskDetail,
} from "@/lib/engine";

/**
 * `/compare` — Phase 3.0 item 3.6: MULTI-MODEL COMPARE / A/B.
 *
 * Runs the SAME prompt against 2+ models (one engine task each) and renders
 * them side-by-side: status, latency, tokens (in/out/total), dollar cost, and
 * the final output. Model options come from the live engine health providers
 * (ollama local + any keyed cloud providers). Pure client-side composition
 * over the existing REST contract — the API change this round is that usage
 * is now PERSISTED on the task record (TaskService.markUsage, engine worker)
 * so the numbers here are real, not estimated.
 *
 * DESIGN_SKILL language; honest states for running/failed/unreachable.
 */
const POLL_MS = 2500;
const MAX_POLLS = 60; // 2.5 min per model

interface CompareResult {
  model: string;
  taskId: string | null;
  detail: EngineTaskDetail | null;
  error: string | null;
  running: boolean;
  /** Phase 4.0 backlog #5 — deterministic quality score of the final output. */
  quality: QualityScore | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatLatency(detail: EngineTaskDetail | null): string {
  if (!detail?.startedAt || !detail.completedAt) return "—";
  const ms = new Date(detail.completedAt).getTime() - new Date(detail.startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number | null): string {
  if (cost === null) return "—";
  if (cost === 0) return "$0";
  if (cost < 0.0001) return `$${cost.toExponential(2)}`;
  return `$${cost.toFixed(6)}`;
}

function resultSummary(detail: EngineTaskDetail | null): string {
  if (!detail) return "";
  const r = detail.result;
  if (r && typeof r === "object" && "summary" in r && typeof (r as { summary: unknown }).summary === "string") {
    return (r as { summary: string }).summary;
  }
  // Fall back to the last "done" step's result.
  for (let i = detail.steps.length - 1; i >= 0; i--) {
    const step = detail.steps[i];
    if (!step) continue;
    if (step.type === "done" && step.content && typeof step.content === "object") {
      const c = step.content as { result?: unknown };
      if (typeof c.result === "string") return c.result;
    }
  }
  return detail.result ? JSON.stringify(detail.result).slice(0, 200) : "";
}

export function CompareView() {
  const { token } = useAuth();
  const [health, setHealth] = React.useState<EngineHealth | null>(null);
  const [prompt, setPrompt] = React.useState(
    "Compare: explain in two sentences how a durable task queue works.",
  );
  const [selected, setSelected] = React.useState<string[]>([]);
  const [maxSteps, setMaxSteps] = React.useState(3);
  const [running, setRunning] = React.useState(false);
  const [results, setResults] = React.useState<CompareResult[]>([]);

  React.useEffect(() => {
    let active = true;
    void fetchEngineHealth().then((r) => {
      if (active && r.state === "ok") setHealth(r.data);
    });
    return () => {
      active = false;
    };
  }, []);

  const models = React.useMemo(() => {
    if (!health?.model) return [];
    const list = health.model.providers?.length ? health.model.providers : [health.model];
    return list.map((p) => ({
      key: `${p.provider}:${p.model}`,
      provider: p.provider,
      model: p.model,
      reachable: p.reachable,
    }));
  }, [health]);

  const toggleModel = (key: string) => {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const pollTask = async (taskId: string): Promise<EngineTaskDetail | null> => {
    for (let i = 0; i < MAX_POLLS; i++) {
      const r = await fetchEngineTask(taskId, token);
      if (r.state === "ok") {
        if (isTerminalStatus(r.data.status)) return r.data;
      } else if (r.state === "not-found") {
        return null;
      }
      await sleep(POLL_MS);
    }
    return null;
  };

  const run = async () => {
    if (!token || running || selected.length === 0) return;
    setRunning(true);
    const entries: CompareResult[] = selected.map((key) => {
      const m = models.find((x) => x.key === key);
      return { model: m ? `${m.provider} · ${m.model}` : key, taskId: null, detail: null, error: null, running: true, quality: null };
    });
    setResults(entries);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const modelId = selected[i];
      const submit = await submitEngineTask(
        { title: `Compare: ${entry.model}`, prompt, model: modelId, maxSteps },
        token,
      );
      if (!submit.ok) {
        setResults((prev) =>
          prev.map((r) => (r.model === entry.model ? { ...r, running: false, error: submit.message, quality: null } : r)),
        );
        continue;
      }
      const detail = await pollTask(submit.task.id);
      const text = detail ? resultSummary(detail) : "";
      const quality = detail ? scoreQuality(text, detail.status === "completed") : null;
      setResults((prev) =>
        prev.map((r) => (r.model === entry.model ? { ...r, running: false, taskId: submit.task.id, detail, quality } : r)),
      );
    }
    setRunning(false);
  };

  const copyResult = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard denial is silent — same as the engine Result panel */
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Reveal>
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Compare models</h1>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Run the same prompt against 2+ models side-by-side — quality, latency, tokens, cost, output.
            </p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="size-4 text-neutral-400" /> New comparison
            </CardTitle>
            <CardDescription>
              One engine task per model — usage is persisted on each task (multi-model compare round).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              aria-label="Prompt"
              className="w-full resize-y rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-900 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Models:</span>
              {models.length === 0 ? (
                <span className="text-xs text-neutral-400">Loading available models…</span>
              ) : (
                models.map((m) => {
                  const active = selected.includes(m.key);
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => toggleModel(m.key)}
                      disabled={!m.reachable}
                      aria-pressed={active}
                      title={m.reachable ? undefined : "Provider unreachable — disabled"}
                      className={[
                        "press-scale inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        active
                          ? "border-accent/30 bg-accent/10 text-accent"
                          : m.reachable
                            ? "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/5"
                            : "cursor-not-allowed border-neutral-200 text-neutral-300 dark:border-white/5 dark:text-neutral-600",
                      ].join(" ")}
                    >
                      {m.reachable ? <span className="size-1.5 rounded-full bg-emerald-500" /> : <XCircle className="size-3" />}
                      {m.provider} · {m.model}
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Max steps
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(Math.max(1, Math.min(20, Number(e.target.value) || 3)))}
                  className="w-16 rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-white/10 dark:bg-neutral-900"
                />
              </label>
              <Button onClick={() => void run()} disabled={running || selected.length === 0} className="press-scale">
                {running ? <Loader2 className="animate-spin" /> : <Play />}
                {running ? "Running…" : "Run comparison"}
              </Button>
              {selected.length === 0 ? (
                <span className="text-xs text-neutral-400">Select at least one model.</span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </Reveal>

      {results.length > 0 ? (
        <div className="mt-6">
          <Reveal delay={0.1}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Results</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200/80 text-xs uppercase tracking-wider text-neutral-400 dark:border-white/[0.06]">
                      <th className="py-2 pr-4 font-semibold">Model</th>
                      <th className="py-2 pr-4 font-semibold">Status</th>
                      <th className="py-2 pr-4 font-semibold">Quality</th>
                      <th className="py-2 pr-4 font-semibold">Latency</th>
                      <th className="py-2 pr-4 font-semibold">Tokens in/out</th>
                      <th className="py-2 pr-4 font-semibold">Total</th>
                      <th className="py-2 font-semibold">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.model} className="border-b border-neutral-200/60 last:border-0 dark:border-white/[0.04]">
                        <td className="py-2 pr-4 font-medium text-neutral-800 dark:text-neutral-200">{r.model}</td>
                        <td className="py-2 pr-4">
                          {r.running ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                              <Loader2 className="size-3 animate-spin" /> running
                            </span>
                          ) : r.detail?.status === "completed" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="size-3" /> completed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                              <XCircle className="size-3" /> {r.detail?.status ?? "failed"}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {r.quality ? (
                            <span className="inline-flex items-center gap-1.5" title="Heuristic output-quality score (length + coherence). Not a semantic judge.">
                              <Sparkles className="size-3 text-amber-500 dark:text-amber-400" />
                              <span className="font-semibold tabular-nums text-neutral-700 dark:text-neutral-200">{r.quality.total}</span>
                              <span className="text-xs text-neutral-400">{r.quality.label}</span>
                            </span>
                          ) : (
                            <span className="text-neutral-300 dark:text-neutral-600">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 tabular-nums text-neutral-500 dark:text-neutral-400">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3" /> {formatLatency(r.detail)}
                          </span>
                        </td>
                        <td className="py-2 pr-4 tabular-nums text-neutral-500 dark:text-neutral-400">
                          {r.detail?.inputTokens ?? "—"} / {r.detail?.outputTokens ?? "—"}
                        </td>
                        <td className="py-2 pr-4 tabular-nums text-neutral-500 dark:text-neutral-400">
                          {r.detail?.totalTokens ?? "—"}
                        </td>
                        <td className="py-2 tabular-nums text-neutral-500 dark:text-neutral-400">
                          <span className="inline-flex items-center gap-1">
                            <Coins className="size-3" /> {formatCost(r.detail?.costUSD ?? null)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </Reveal>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {results.map((r) => {
              const text = resultSummary(r.detail);
              return (
                <Reveal key={r.model} delay={0.05}>
                  <Card className={r.detail?.status === "failed" ? "border-rose-300/40 dark:border-rose-500/20" : ""}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between text-sm">
                        <span>{r.model}</span>
                        {r.detail ? (
                          <button
                            type="button"
                            aria-label="Copy result"
                            onClick={() => void copyResult(text || r.detail?.error || "")}
                            className="press-scale rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/10"
                          >
                            <Copy className="size-3.5" />
                          </button>
                        ) : null}
                      </CardTitle>
                      <CardDescription>
                        {r.detail
                          ? `${r.detail.status} · ${formatLatency(r.detail)} · ${r.detail?.totalTokens ?? 0} tokens · ${formatCost(r.detail?.costUSD ?? null)}${r.quality ? ` · quality ${r.quality.total} (${r.quality.label})` : ""}`
                          : "pending"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {r.error ? (
                        <p className="text-sm text-rose-600 dark:text-rose-400">{r.error}</p>
                      ) : r.running ? (
                        <p className="flex items-center gap-2 text-sm text-neutral-400">
                          <Loader2 className="size-4 animate-spin" /> Running on the engine…
                        </p>
                      ) : r.detail?.status === "failed" ? (
                        <p className="text-sm text-rose-600 dark:text-rose-400">{r.detail.error ?? "Task failed"}</p>
                      ) : text ? (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700 dark:text-neutral-200">
                          {text.length > 400 ? `${text.slice(0, 400)}…` : text}
                        </p>
                      ) : (
                        <p className="flex items-center gap-2 text-sm text-neutral-400">
                          <FileText className="size-4" /> No output captured.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </Reveal>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
