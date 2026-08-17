"use client";

import * as React from "react";
import { GitBranch, Loader2, Network, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { delegateTask, fetchTaskTree, type DelegationTreeNode } from "@/lib/engine";
import { API_BASE } from "@/lib/api-base";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "./status-badge";

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Crews round (Phase 4.0 4.1) — the delegation tree inside the task detail
 * dialog. Shows the durable parent/child tree under the selected task and lets
 * the task's owner delegate a sub-agent task (title + prompt) right there.
 * The tree re-fetches after each delegate so the new child appears live.
 * Crews follow-up: budget flow-down (descendants' cumulative tokens/cost) +
 * a Merge-results action that folds the children's outcomes into the parent's
 * result.
 */
export function DelegationSection({
  token,
  taskId,
  canManage,
}: {
  token: string | null;
  taskId: string;
  canManage: boolean;
}) {
  const [tree, setTree] = React.useState<DelegationTreeNode | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [delegating, setDelegating] = React.useState(false);
  const [merging, setMerging] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [prompt, setPrompt] = React.useState("");

  const refresh = React.useCallback(async () => {
    const t = await fetchTaskTree(token, taskId);
    setTree(t);
    setLoading(false);
  }, [token, taskId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleMerge = async () => {
    setMerging(true);
    try {
      const res = await fetch(`${API_BASE}/engine/tasks/${encodeURIComponent(taskId)}/merge`, {
        method: "POST",
        headers: authHeaders(token),
      });
      if (res.ok) {
        toast.success(`Merged ${tree?.childCount ?? 0} sub-agent result(s) into this task.`);
        void refresh();
      } else {
        toast.error("Merge failed.");
      }
    } finally {
      setMerging(false);
    }
  };

  const handleDelegate = async () => {
    if (!title.trim() || !prompt.trim()) {
      toast.error("Title and prompt are required to delegate.");
      return;
    }
    setDelegating(true);
    const result = await delegateTask(token, taskId, { title: title.trim(), prompt: prompt.trim() });
    setDelegating(false);
    if (!result.ok) {
      toast.error(`Delegate failed: ${result.error ?? "unknown error"}`);
      return;
    }
    toast.success("Sub-agent task delegated — it is now running under this task.");
    setTitle("");
    setPrompt("");
    void refresh();
  };

  const count = (() => {
    let n = 0;
    const walk = (node: DelegationTreeNode | null) => {
      if (!node) return;
      n += 1;
      for (const kid of node.children) walk(kid);
    };
    walk(tree);
    return n;
  })();

  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
          <Network className="size-4 text-neutral-400" />
          Delegation
          {tree && tree.children.length > 0 ? (
            <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-normal text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {count} tasks · {tree.childrenTotalTokens ?? 0} tok · ${(tree.childrenCostUSD ?? 0).toFixed(5)}
            </span>
          ) : null}
        </h3>
        {loading ? (
          <Loader2 className="size-3.5 animate-spin text-neutral-400" />
        ) : (
          <div className="flex items-center gap-1">
            {canManage && tree && tree.children.length > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void handleMerge()} disabled={merging} aria-label="Merge sub-agent results">
                {merging ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />} Merge results
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()}>
              <GitBranch className="size-3.5" /> Refresh
            </Button>
          </div>
        )}
      </div>

      {tree && tree.children.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          No sub-agent tasks yet — this task has not delegated work.
        </p>
      ) : null}

      {tree && tree.children.length > 0 ? (
        <ul className="mt-2 space-y-1.5 text-xs">
          <TreeNodeRow node={tree} depth={0} />
        </ul>
      ) : null}

      {canManage ? (
        <div className="mt-3 grid gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <label className="flex items-center gap-2 text-xs font-medium text-neutral-600 dark:text-neutral-300">
            <UserPlus className="size-3.5" /> Delegate a sub-agent task
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sub-agent title"
            aria-label="Sub-agent title"
            className="h-8 text-sm"
          />
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the sub-agent do?"
            aria-label="Sub-agent prompt"
            className="h-8 text-sm"
          />
          <div>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleDelegate()}
              disabled={delegating}
            >
              {delegating ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
              Delegate
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TreeNodeRow({ node, depth }: { node: DelegationTreeNode; depth: number }) {
  return (
    <>
      <li className="flex items-center gap-2" style={{ paddingLeft: depth * 14 }}>
        <span className="h-px w-3 bg-neutral-300 dark:bg-neutral-700" aria-hidden />
        <span className="font-mono text-neutral-600 dark:text-neutral-300">{node.title}</span>
        <StatusBadge status={node.status} />
        {node.totalTokens !== null ? (
          <span className="text-neutral-400">· {node.totalTokens} tok</span>
        ) : null}
      </li>
      {node.children.map((kid) => (
        <TreeNodeRow key={kid.id} node={kid} depth={depth + 1} />
      ))}
    </>
  );
}
