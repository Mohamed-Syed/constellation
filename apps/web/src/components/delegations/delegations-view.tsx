"use client";

import * as React from "react";
import { GitBranch, Loader2, Merge, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatAgo } from "@/lib/use-live";
import {
  fetchDelegations,
  mergeDelegation,
  type DelegationTreeNode,
  type DelegationsResponse,
} from "@/lib/delegations";

/** Task status → shared Badge variant (maps to daisyUI success/danger/neutral/info). */
function statusVariant(status: string): "success" | "danger" | "neutral" | "info" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "running") return "info";
  return "neutral";
}

/** One node in the delegation tree, rendered indented by depth. */
function TreeNode({ node, depth }: { node: DelegationTreeNode; depth: number }) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  return (
    <li className="flex flex-col gap-1">
      <div
        className="flex items-center gap-2 text-sm"
        style={{ paddingLeft: `${depth * 1.25}rem` }}
      >
        {depth > 0 ? <span className="text-base-content/30 select-none">└─</span> : null}
        <span className="truncate font-medium">{node.title || "(untitled)"}</span>
        <Badge variant={statusVariant(node.status)}>{node.status}</Badge>
        {node.model ? (
          <span className="text-xs text-base-content/50">{node.provider ?? "model"}:{node.model}</span>
        ) : null}
        {node.totalTokens ? (
          <span className="font-mono text-xs text-base-content/50 tabular-nums">
            {node.totalTokens} tok
          </span>
        ) : null}
      </div>
      {hasChildren && node.children ? (
        <ul className="flex flex-col gap-1">
          {node.children.map((kid) => (
            <TreeNode key={kid.id} node={kid} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** One crew root card: the tree + budget flow-down + a Merge control. */
function DelegationCard({
  root,
  onMerge,
}: {
  root: DelegationTreeNode;
  onMerge: (t: DelegationTreeNode) => Promise<void> | void;
}) {
  const [merging, setMerging] = React.useState(false);
  const descendants = root.childCount ?? 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4" /> {root.title || "(untitled crew)"}
          </CardTitle>
          <CardDescription className="mt-1">
            {descendants} sub-agent{descendants === 1 ? "" : "s"} · created{" "}
            {formatAgo(root.createdAt ? new Date(root.createdAt).getTime() : null)}
            {root.childrenTotalTokens
              ? ` · ${root.childrenTotalTokens} sub-agent tokens`
              : ""}
            {root.childrenCostUSD ? ` · $${root.childrenCostUSD.toFixed(6)}` : ""}
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={merging || descendants === 0}
          onClick={() => {
            setMerging(true);
            void Promise.resolve(onMerge(root)).finally(() => setMerging(false));
          }}
        >
          {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
          Merge results
        </Button>
      </CardHeader>
      <CardContent>
        {root.children && root.children.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {root.children.map((kid) => (
              <TreeNode key={kid.id} node={kid} depth={1} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-base-content/50">No child agents.</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Portal-wide delegation view (Phase 4.0 backlog #1) — every agent crew
 * (parent → children) with its full tree and budget flow-down, beyond the
 * per-task dialog. Scope mirrors the engine task list (admin sees all).
 */
export function DelegationsView() {
  const { token } = useAuth();
  const [data, setData] = React.useState<DelegationsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetchDelegations(token);
      setData(res);
      setError(null);
    } catch {
      setError("Could not load delegations.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const handleMerge = async (root: DelegationTreeNode) => {
    const ok = await mergeDelegation(token, root.id);
    if (ok) {
      toast.success(`Merged results for "${root.title || root.id}".`);
    } else {
      toast.error(`Could not merge results for "${root.title || root.id}".`);
    }
    await load();
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Delegations</h1>
          <p className="text-sm text-base-content/70">
            Every agent crew - orchestrator tasks that spawned sub-agents - shown as a live tree
            with budget flow-down and one-click result merging.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-amber-600 dark:text-amber-400">{error}</p>
      ) : null}

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-base-content/60">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading delegations…
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-xl border border-base-300 bg-base-100 p-12 text-center text-sm text-base-content/60">
          No delegations yet. Submit an orchestrator task, then delegate sub-agent tasks to it
          from the Engine view to see the crew tree here.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {data.items.map((root) => (
            <DelegationCard key={root.id} root={root} onMerge={handleMerge} />
          ))}
        </div>
      )}
    </div>
  );
}
