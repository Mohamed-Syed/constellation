"use client";

import * as React from "react";

import { Activity, AlertTriangle, CheckCircle2, CircleDashed, Loader2, Radio, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Reveal } from "@/components/motion/reveal";
import { fetchEngineHealth, type EngineAlert, type EngineHealth } from "@/lib/engine";
import { formatAgo } from "@/lib/use-live";

/**
 * `/health` — live engine health dashboard (Phase 2.0 item 2.4).
 *
 * Renders the public `GET /api/engine/health` payload (v0.5 shape: queue depth,
 * model availability incl. providers[], scheduler state, supervisor totals,
 * alert trail) as an operator-facing dashboard that polls every 5 seconds.
 * Follows the DESIGN_SKILL language: `surface` cards, staggered `Reveal`,
 * both themes. Degrades honestly — engine unavailable, API unreachable, and
 * empty alert trail all have explicit states.
 */
const POLL_MS = 5000;

function Stat({ label, value, tone = "default" }: { label: string; value: React.ReactNode; tone?: "default" | "ok" | "warn" | "danger" }) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "danger"
          ? "text-rose-600 dark:text-rose-400"
          : "text-foreground";
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok
          ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
          : "bg-rose-500/10 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`} />
      {children}
    </span>
  );
}

export function HealthDashboard() {
  const [health, setHealth] = React.useState<EngineHealth | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null);

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      const result = await fetchEngineHealth();
      if (!active) return;
      if (result.state === "ok") {
        setHealth(result.data);
        setError(null);
        setLastUpdated(Date.now());
      } else {
        // Keep the last good snapshot; only surface the error on first load.
        setError((prev) => (prev === null && health === null ? result.message : prev ?? result.message));
      }
      setLoading(false);
    };
    void load();
    const id = setInterval(() => {
      if (active) void load();
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const engineOk = health?.engine === "available";

  return (
    <Reveal className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Activity className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Engine Health</h1>
          <p className="text-sm text-muted-foreground">
            Live snapshot of the agentic task runtime — polls every {POLL_MS / 1000}s
          </p>
        </div>
        {health ? (
          engineOk ? (
            <Pill ok>Engine available</Pill>
          ) : (
            <Pill ok={false}>Engine unavailable</Pill>
          )
        ) : null}
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {loading && !health ? (
        <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Loading engine health…
        </div>
      ) : !health ? (
        <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
          <CircleDashed className="h-5 w-5" aria-hidden />
          No health data yet.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Engine status + queue */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Reveal delay={0.05}>
              <Card className="h-full surface-hover">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Engine</CardTitle>
                  <CardDescription>{engineOk ? "Queue backend reachable" : "Degraded"}</CardDescription>
                </CardHeader>
                <CardContent>
                  {engineOk ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-500" aria-hidden />
                  ) : (
                    <AlertTriangle className="h-6 w-6 text-rose-500" aria-hidden />
                  )}
                  {!engineOk && health.reason && <p className="mt-2 text-sm text-muted-foreground">{health.reason}</p>}
                </CardContent>
              </Card>
            </Reveal>
            <Reveal delay={0.1}>
              <Card className="h-full surface-hover">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Queue depth</CardTitle>
                  <CardDescription>{health.queue?.queue ?? "engine-tasks"}</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <Stat label="Waiting" value={health.queue?.waiting ?? 0} tone={health.queue && health.queue.waiting > 0 ? "warn" : "default"} />
                  <Stat label="Active" value={health.queue?.active ?? 0} tone="default" />
                  <Stat label="Failed jobs" value={health.queue?.failed ?? 0} tone={health.queue && health.queue.failed > 0 ? "danger" : "default"} />
                  <Stat label="Failed tasks" value={health.queue?.failedTasks ?? 0} tone={health.queue && health.queue.failedTasks > 0 ? "danger" : "default"} />
                </CardContent>
              </Card>
            </Reveal>
            <Reveal delay={0.15}>
              <Card className="h-full surface-hover">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Scheduler</CardTitle>
                  <CardDescription>Autonomous triggers</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Poll loop</span>
                    {health.scheduler.enabled ? <Pill ok>running</Pill> : <Pill ok={false}>off</Pill>}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Poll interval</span>
                    <span className="text-sm font-medium tabular-nums">{(health.scheduler.pollIntervalMs / 1000).toFixed(0)}s</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Last sweep</span>
                    <span className="text-sm font-medium tabular-nums">{formatAgo(health.scheduler.lastSweepAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Due count</span>
                    <span className="text-sm font-medium tabular-nums">{health.scheduler.dueCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Event hooks</span>
                    <span className="text-sm font-medium tabular-nums">{health.scheduler.registeredEvents}</span>
                  </div>
                </CardContent>
              </Card>
            </Reveal>
            <Reveal delay={0.2}>
              <Card className="h-full surface-hover">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Supervisor</CardTitle>
                  <CardDescription>Stuck-task recovery</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <Stat label="Stale found" value={health.supervision.staleFound} tone={health.supervision.staleFound > 0 ? "warn" : "default"} />
                  <Stat label="Recovered" value={health.supervision.recovered} tone={health.supervision.recovered > 0 ? "ok" : "default"} />
                  <Stat label="Stalled (DLQ)" value={health.supervision.failedStalled} tone={health.supervision.failedStalled > 0 ? "danger" : "default"} />
                  <Stat label="Last sweep" value={formatAgo(health.supervision.lastSweepAt)} />
                </CardContent>
              </Card>
            </Reveal>
          </div>

          {/* Model availability */}
          <Reveal delay={0.25}>
            <Card className="surface-hover">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Radio className="h-4 w-4" aria-hidden /> Model providers
                </CardTitle>
                <CardDescription>Primary verdict + every configured provider</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-xl border border-border/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{health.model.provider}</span>
                      <Pill ok={health.model.reachable}>{health.model.reachable ? "reachable" : "unreachable"}</Pill>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{health.model.model || "default model"}</p>
                    {health.model.error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{health.model.error}</p>}
                  </div>
                  {(health.model.providers ?? []).map((p) => (
                    <div key={p.provider} className="rounded-xl border border-border/60 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{p.provider}</span>
                        <Pill ok={p.reachable}>{p.reachable ? "reachable" : "unreachable"}</Pill>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{p.model || "default model"}</p>
                      {p.error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{p.error}</p>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Reveal>

          {/* Alert trail */}
          <Reveal delay={0.3}>
            <Card className="surface-hover">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Alert trail</CardTitle>
                <CardDescription>
                  Recent engine events (ring buffer — resets on restart)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {health.alerts.length === 0 ? (
                  <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
                    All quiet — no engine alerts recorded this process lifetime.
                  </p>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {health.alerts.map((a: EngineAlert, i: number) => (
                      <li key={`${a.at}-${i}`} className="flex items-start gap-3 py-2.5">
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                            a.type.includes("failed") ? "bg-rose-500" : a.type.includes("stale") ? "bg-amber-500" : "bg-emerald-500"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{a.type}</p>
                          {a.detail && <p className="truncate text-xs text-muted-foreground">{a.detail}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs tabular-nums text-muted-foreground">{formatAgo(a.at)}</p>
                          {a.taskId && <p className="max-w-40 truncate text-[11px] text-muted-foreground/70">{a.taskId}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </Reveal>

          {/* Footer: last updated */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <RefreshCw className="h-3 w-3" aria-hidden />
              Auto-refreshes every {POLL_MS / 1000}s
            </span>
            <span>
              Last updated {lastUpdated ? `${Math.max(0, Math.round((Date.now() - lastUpdated) / 1000))}s ago` : "…"} ·{" "}
              {new Date(health.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}
    </Reveal>
  );
}
