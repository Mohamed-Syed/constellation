"use client";

import * as React from "react";
import { BrainCircuit, Clock, Database, FileText, GitBranch, Lock, RefreshCw } from "lucide-react";

import {
  BRAIN_READ_PERMISSION,
  fetchBrainGraph,
  fetchBrainStats,
  type BrainGraph,
  type BrainResult,
  type BrainStats,
} from "@/lib/brain";
import { hasPermission } from "@/lib/permissions";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Reveal } from "@/components/motion/reveal";
import { BrainAskBox } from "./brain-ask-box";
import { BrainGraphView } from "./brain-graph-view";

/**
 * The Brain page (BRAIN.md §5/§6).
 *
 * Composes three surfaces: stats, the force-directed graph, and the ask box.
 * Every one degrades independently and gracefully — the brain is a subsystem
 * that legitimately may not exist yet (the Graphify sidecar is a separate service and
 * the REST routes are separate), so "not built yet" is a first-class, calm state
 * here, not an error. The page never blanks and never throws.
 *
 * Gating is role-aware exactly like the Admin surface: `core:brain:read` (or an
 * implying wildcard / `platform:admin`) hides the nav item and turns this page
 * into a permission notice. That's UX only — the API's RBAC guards are the
 * actual boundary.
 */
export function BrainView() {
  const { token, permissions } = useAuth();
  const canRead = hasPermission(permissions, BRAIN_READ_PERMISSION);

  const [graph, setGraph] = React.useState<BrainResult<BrainGraph> | null>(null);
  const [stats, setStats] = React.useState<BrainResult<BrainStats> | null>(null);
  const [highlight, setHighlight] = React.useState<string[]>([]);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (!canRead || !token) return;
    let active = true;
    void (async () => {
      const [g, s] = await Promise.all([fetchBrainGraph(token), fetchBrainStats(token)]);
      if (!active) return;
      setGraph(g);
      setStats(s);
    })();
    return () => {
      active = false;
    };
  }, [token, canRead, reloadKey]);

  if (!canRead) {
    return (
      <PageFrame>
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
          <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <Lock className="size-5" />
          </span>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            You don&apos;t have access to the brain.
          </p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Requires the <code className="font-mono">{BRAIN_READ_PERMISSION}</code> permission.
          </p>
        </div>
      </PageFrame>
    );
  }

  const loading = graph === null || stats === null;
  // The graph result decides the page-level story: only a real graph gets rendered.
  const notBuilt = graph?.state === "not-built";
  const unreachable = graph?.state === "unreachable";
  const forbidden = graph?.state === "forbidden";

  return (
    <PageFrame
      action={
        <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      }
    >
      <div className="space-y-6">
        <StatsRow stats={stats} />

        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <GitBranch className="size-4" />
            </span>
            <CardTitle className="text-base">Knowledge graph</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <EmptyState title="Loading the knowledge graph…" />
            ) : graph.state === "ok" ? (
              <BrainGraphView graph={graph.data} highlightIds={highlight} />
            ) : (
              <EmptyState
                title={
                  notBuilt
                    ? "The brain hasn't been built yet"
                    : forbidden
                      ? "Not permitted"
                      : "Can't reach the brain"
                }
                body={graph.message}
                hint={
                  notBuilt
                    ? "Start the Graphify sidecar over the corpus (docs/ + brain/) — see docs/BRAIN.md §6."
                    : unreachable
                      ? "The Constellation API may still be starting up."
                      : undefined
                }
              />
            )}
          </CardContent>
        </Card>

        <BrainAskBox
          token={token}
          canRead={canRead}
          caveat={
            graph && graph.state !== "ok"
              ? notBuilt
                ? "The knowledge graph isn't built yet — answers will fall back to a text match over the brain/ vault and be flagged ungrounded."
                : graph.message
              : null
          }
          onProvenanceChange={setHighlight}
        />
      </div>
    </PageFrame>
  );
}

function PageFrame({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            <BrainCircuit className="size-6 text-accent" />
            Brain
          </h1>
          <p className="mt-2 max-w-2xl text-neutral-500 dark:text-neutral-400">
            The platform&apos;s persistent memory: a knowledge graph over the corpus. Explore the
            structure, or ask a question and get an answer grounded in named sources.
          </p>
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

function StatsRow({ stats }: { stats: BrainResult<BrainStats> | null }) {
  const data = stats?.state === "ok" ? stats.data : null;
  // `available` is the API's own "is there a graph" signal — trust it rather
  // than inferring from counts.
  const built = data?.available === true;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-4">
        <Reveal delay={0}><StatCard icon={<Database className="size-4" />} label="Nodes" value={data ? formatCount(data.nodes) : "—"} /></Reveal>
        <Reveal delay={0.05}><StatCard icon={<GitBranch className="size-4" />} label="Edges" value={data ? formatCount(data.edges) : "—"} /></Reveal>
        <Reveal delay={0.1}>
          <StatCard
            icon={<FileText className="size-4" />}
            label="Vault notes"
            value={data ? formatCount(data.vaultNotes) : "—"}
          />
        </Reveal>
        <Reveal delay={0.15}>
          <StatCard
            icon={<Clock className="size-4" />}
            label="Last built"
            value={data?.lastBuiltAt ? formatWhen(data.lastBuiltAt) : "never"}
            badge={
              stats === null ? null : built ? (
                <Badge variant="success">live</Badge>
              ) : (
                <Badge variant="warning">not built</Badge>
              )
            }
          />
        </Reveal>
      </div>
      {/* The engine's own explanation of why it's unavailable beats our guess. */}
      {data && !built && data.detail ? (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">{data.detail}</p>
      ) : null}
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="surface surface-hover rounded-xl p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
        <span className="text-neutral-400">{icon}</span>
        {label}
        {badge ? <span className="ml-auto">{badge}</span> : null}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">{value}</div>
    </div>
  );
}

function EmptyState({ title, body, hint }: { title: string; body?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
      <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        <BrainCircuit className="size-5" />
      </span>
      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500 dark:text-neutral-400">{body}</p> : null}
      {hint ? <p className="mx-auto mt-2 max-w-md text-xs text-neutral-400 dark:text-neutral-500">{hint}</p> : null}
    </div>
  );
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** Render a build timestamp defensively — a malformed date must not blank the card. */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
