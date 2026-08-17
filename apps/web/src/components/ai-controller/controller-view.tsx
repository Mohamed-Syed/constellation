"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Info,
  Loader2,
  Play,
  Radar,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Reveal } from "@/components/motion/reveal";
import { formatAgo } from "@/lib/use-live";
import {
  fetchControllerActions,
  fetchControllerStatus,
  runControllerAction,
  SEVERITY_LABEL,
  type ControllerFinding,
  type ControllerSnapshot,
  type FindingSeverity,
} from "@/lib/ai-controller";

/** Severity → the shared Badge variant (crit/warn/info/ok map to danger/warning/info/success). */
const SEVERITY_VARIANT: Record<FindingSeverity, "danger" | "warning" | "info" | "success" | "neutral"> = {
  crit: "danger",
  warn: "warning",
  info: "info",
  ok: "success",
};

/** Human description of each whitelisted action, shown on its run button. */
const ACTION_HINT: Record<string, string> = {
  "reprobe-mesh": "Probe every registered mesh peer now.",
  "re-enqueue-deadletters": "Flip failed tasks back to queued and re-run them.",
  "flush-stale": "Run one supervisor sweep (recover stale, fail stalled).",
  "run-deepseek-diagnostic": "Enqueue a tiny diagnostic task on deepseek-v4-flash.",
};

/**
 * Phase 5.0 — AGENTIC AI CONTROLLER portal page. Renders the platform's live
 * stability snapshot (score + findings + recommended actions) and lets an
 * admin run the whitelisted safe recovery actions with one click. Polls at a
 * fixed cadence with the same monotonic seq guard as the mesh view; findings
 * are filterable by severity (the dashboard stat-card drill-down pattern).
 */
export function ControllerView() {
  const { token } = useAuth();
  const [snapshot, setSnapshot] = React.useState<ControllerSnapshot | null>(null);
  const [actions, setActions] = React.useState<string[]>([]);
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<"all" | FindingSeverity>("all");
  const seqRef = React.useRef(0);
  // Unmount guard: an in-flight poll resolving after unmount (or after a token
  // change re-created the effect) must not setState on a dead component.
  const mountedRef = React.useRef(true);

  const load = React.useCallback(async () => {
    const seq = ++seqRef.current;
    const snap = await fetchControllerStatus(token);
    if (!mountedRef.current || seq !== seqRef.current) return;
    if (snap) {
      setSnapshot(snap);
      setLoadError(null);
    } else {
      setLoadError("Refresh failed - the AI Controller API did not answer.");
    }
  }, [token]);

  React.useEffect(() => {
    mountedRef.current = true;
    void load();
    // Status reflects probe cadence (mesh sweeps every ~5s) — 10s poll keeps
    // the page live without hammering the API.
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [load]);

  React.useEffect(() => {
    let activePoll = true;
    void fetchControllerActions(token).then((list) => {
      if (activePoll) setActions(list);
    });
    return () => {
      activePoll = false;
    };
  }, [token]);

  const runAction = async (action: string) => {
    setBusyAction(action);
    try {
      const result = await runControllerAction(token, action);
      if (result.ok && result.ran) {
        toast.success(result.message);
      } else if (result.ok && !result.ran) {
        toast.info(result.message);
      } else {
        toast.error(result.message);
      }
      await load();
    } finally {
      // Only re-enable after the reload round-trip, so a fast second click can
      // never double-fire while the panel is mid-action.
      setBusyAction(null);
    }
  };

  const counts: Record<"all" | FindingSeverity, number> = {
    all: snapshot?.findings.length ?? 0,
    crit: snapshot?.findings.filter((f) => f.severity === "crit").length ?? 0,
    warn: snapshot?.findings.filter((f) => f.severity === "warn").length ?? 0,
    info: snapshot?.findings.filter((f) => f.severity === "info").length ?? 0,
    ok: snapshot?.findings.filter((f) => f.severity === "ok").length ?? 0,
  };

  const stats: { key: "all" | FindingSeverity; label: string; icon: typeof Info }[] = [
    { key: "all", label: "Findings", icon: ClipboardList },
    { key: "crit", label: "Critical", icon: XCircle },
    { key: "warn", label: "Warnings", icon: AlertTriangle },
    { key: "info", label: "Info", icon: Info },
    { key: "ok", label: "Healthy", icon: CheckCircle2 },
  ];

  const visibleFindings =
    active === "all" ? (snapshot?.findings ?? []) : (snapshot?.findings ?? []).filter((f) => f.severity === active);

  const score = snapshot?.score ?? null;
  const label = snapshot?.label ?? null;
  const scoreTone =
    score === null
      ? "text-base-content/40"
      : score >= 90
        ? "text-emerald-600 dark:text-emerald-400"
        : score >= 70
          ? "text-amber-600 dark:text-amber-400"
          : score >= 40
            ? "text-orange-600 dark:text-orange-400"
            : "text-rose-600 dark:text-rose-400";

  return (
    <Reveal className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
            <Radar className="size-3.5" />
            Phase 5.0 · Agentic AI Controller
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Controller</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The platform&apos;s own operator - a live stability score, per-subsystem findings, and the
            whitelisted safe recovery actions it can run. Admin only.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          {loadError} Retrying…
        </div>
      ) : null}

      {/* Score hero */}
      <Card className="surface-hover">
        <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-20 items-center justify-center rounded-2xl bg-base-200/60 ring-1 ring-base-300">
              <span className={`text-4xl font-semibold tabular-nums ${scoreTone}`}>{score ?? "—"}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold">{label ?? "No data"}</span>
                {label === "Healthy" ? (
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                ) : label ? (
                  <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                Stability score · {snapshot ? `generated ${formatAgo(snapshot.generatedAt)}` : "waiting for the first snapshot…"}
              </p>
            </div>
          </div>
          {snapshot && snapshot.actionsRecommended.length > 0 ? (
            <div className="flex max-w-sm flex-col gap-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recommended</p>
              {snapshot.actionsRecommended.map((rec) =>
                actions.includes(rec) ? (
                  <Button key={rec} size="sm" onClick={() => void runAction(rec)} disabled={busyAction !== null}>
                    {busyAction === rec ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                    {rec}
                  </Button>
                ) : (
                  <span key={rec} className="text-xs text-muted-foreground">
                    • {rec}
                  </span>
                ),
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Autonomous watch — the HEAL loop lives here and acts on its own. */}
      {snapshot?.watch ? (
        <Card className="surface-hover">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-base-200/60 ring-1 ring-base-300">
                <Activity className="size-5 text-accent" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">Autonomous watch</span>
                  {snapshot.watch.enabled ? (
                    <Badge variant="success">
                      <span className="relative flex size-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                      </span>
                      ON
                    </Badge>
                  ) : (
                    <Badge variant="neutral">OFF</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Scores the platform every {Math.round(snapshot.watch.intervalMs / 1000)}s and runs safe recovery
                  actions by itself — no human needed.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Last tick</p>
                <p className="font-mono tabular-nums">{snapshot.watch.lastTickAt ? formatAgo(snapshot.watch.lastTickAt) : "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Score</p>
                <p className="font-mono tabular-nums">
                  {snapshot.watch.lastScore ?? "—"}
                  {snapshot.watch.lastLabel ? ` · ${snapshot.watch.lastLabel}` : ""}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Last action</p>
                <p className="font-mono tabular-nums">
                  {snapshot.watch.lastAction ? (
                    <>
                      {snapshot.watch.lastAction}
                      <span className="text-muted-foreground"> · {formatAgo(snapshot.watch.lastActionAt)}</span>
                    </>
                  ) : (
                    "none yet"
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Clickable severity cards — drill into the findings below (dashboard pattern). */}
      <div className="stats w-full border border-base-300 bg-base-100 shadow-sm">
        {stats.map((stat) => {
          const isActive = active === stat.key;
          return (
            <button
              key={stat.key}
              type="button"
              onClick={() => setActive(isActive ? "all" : stat.key)}
              aria-pressed={isActive}
              title={`Show ${stat.label.toLowerCase()} findings`}
              className={`stat cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                isActive ? "bg-base-200/50" : "hover:bg-base-200/30"
              }`}
            >
              <div className="stat-figure text-base-content/50">
                <stat.icon className="size-5" />
              </div>
              <div className="stat-value font-mono tabular-nums">{counts[stat.key]}</div>
              <div className="stat-title text-xs uppercase tracking-wider text-base-content/50">{stat.label}</div>
            </button>
          );
        })}
      </div>

      {/* Findings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radar className="size-4" /> Findings
            {snapshot ? (
              <span className="text-xs font-normal text-muted-foreground">· {snapshot.findings.length} total</span>
            ) : null}
          </CardTitle>
          <CardDescription>
            {active === "all"
              ? "Every subsystem the controller inspected, with the concrete issue it found."
              : `Filtered to ${active.toUpperCase()} severity - click any card above to switch back.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!snapshot ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading snapshot…
            </div>
          ) : visibleFindings.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No {active === "all" ? "" : `${active} `}findings right now.
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {visibleFindings.map((finding: ControllerFinding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Whitelist */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Play className="size-4" /> Safe actions
          </CardTitle>
          <CardDescription>
            The whitelist of idempotent recovery actions the controller may run. Anything else is a
            recommendation, never a mutation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No whitelisted actions returned.</div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {actions.map((action) => (
                <li
                  key={action}
                  className="flex flex-col gap-2 rounded-xl border bg-base-200/50 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <code className="text-sm font-medium">{action}</code>
                    <p className="text-xs text-muted-foreground">{ACTION_HINT[action] ?? "Whitelisted safe action."}</p>
                  </div>
                  <Button size="sm" onClick={() => void runAction(action)} disabled={busyAction !== null}>
                    {busyAction === action ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                    Run
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Reveal>
  );
}

/** One finding row — clickable to expand/collapse its full detail. */
function FindingRow({ finding }: { finding: ControllerFinding }) {
  const [open, setOpen] = React.useState(finding.severity === "crit" || finding.severity === "warn");
  const detailId = `finding-${finding.id}-detail`;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={detailId}
        className="flex w-full cursor-pointer flex-col gap-2 rounded-xl border bg-base-200/50 p-4 text-left transition-all duration-150 hover:bg-base-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={SEVERITY_VARIANT[finding.severity]}>{SEVERITY_LABEL[finding.severity]}</Badge>
          <span className="truncate font-medium">{finding.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="neutral">{finding.area}</Badge>
          <Chevron open={open} />
        </div>
      </button>
      {open ? (
        <div id={detailId} className="mt-1.5 rounded-xl border border-base-300 bg-base-100/60 p-4 text-sm text-muted-foreground">
          <p>{finding.detail}</p>
        </div>
      ) : null}
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`size-4 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
