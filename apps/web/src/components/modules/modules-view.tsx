"use client";

import * as React from "react";
import { AlertTriangle, LayoutGrid, Search, Table as TableIcon } from "lucide-react";

import type { PluginSummary } from "@/lib/types";
import { resolveIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { healthBadgeVariant, healthLabel, stateBadgeVariant, stateLabel } from "./plugin-state";

type ViewMode = "grid" | "table";

function matches(plugin: PluginSummary, query: string): boolean {
  if (!query) return true;
  const haystack = `${plugin.name} ${plugin.id} ${plugin.description}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function ModulesView({ plugins }: { plugins: PluginSummary[] }) {
  const [query, setQuery] = React.useState("");
  const [view, setView] = React.useState<ViewMode>("grid");

  const filtered = React.useMemo(() => plugins.filter((p) => matches(p, query)), [plugins, query]);

  if (plugins.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        No modules loaded yet, or the core API isn&apos;t running.
        <div className="mt-2 text-sm">
          Start it with{" "}
          <code className="rounded bg-neutral-200 px-1 py-0.5 dark:bg-neutral-800">
            pnpm --filter @constellation/api dev
          </code>{" "}
          on port 4000.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter modules…"
            className="pl-8"
            aria-label="Filter modules"
          />
        </div>
        <div className="flex items-center gap-1 self-start rounded-lg border border-neutral-200 p-1 dark:border-neutral-800">
          <Button
            type="button"
            variant={view === "grid" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <LayoutGrid className="size-4" />
            Grid
          </Button>
          <Button
            type="button"
            variant={view === "table" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            <TableIcon className="size-4" />
            Table
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          No modules match &quot;{query}&quot;.
        </div>
      ) : view === "grid" ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((plugin) => {
            const Icon = resolveIcon(plugin.navigation?.[0]?.icon);
            return (
              <li key={plugin.id}>
                <Card className="h-full transition hover:shadow-md">
                  <CardHeader className="flex-row items-start justify-between space-y-0">
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{plugin.name}</CardTitle>
                        <CardDescription className="truncate">
                          {plugin.id} · v{plugin.version}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="mb-3 line-clamp-2 min-h-[2.5rem] text-sm text-neutral-500 dark:text-neutral-400">
                      {plugin.description || "No description provided."}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={stateBadgeVariant(plugin.state)}>{stateLabel(plugin.state)}</Badge>
                      {plugin.health ? (
                        <Badge variant={healthBadgeVariant(plugin.health)}>{healthLabel(plugin.health)}</Badge>
                      ) : null}
                      {plugin.permissions.length > 0 ? (
                        <Badge variant="neutral">
                          {plugin.permissions.length} permission{plugin.permissions.length === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </div>
                    {plugin.error ? (
                      <p className="mt-3 flex items-start gap-1.5 text-xs text-rose-500">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <span className="break-words">{plugin.error}</span>
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">Module</th>
                <th className="px-4 py-3 font-medium">Version</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3 font-medium">Permissions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {filtered.map((plugin) => {
                const Icon = resolveIcon(plugin.navigation?.[0]?.icon);
                return (
                  <tr key={plugin.id} className={cn("bg-white dark:bg-neutral-900")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                          <Icon className="size-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{plugin.name}</p>
                          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{plugin.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">v{plugin.version}</td>
                    <td className="px-4 py-3">
                      <Badge variant={stateBadgeVariant(plugin.state)}>{stateLabel(plugin.state)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {plugin.health ? (
                        <Badge variant={healthBadgeVariant(plugin.health)}>{healthLabel(plugin.health)}</Badge>
                      ) : (
                        <span className="text-xs text-neutral-400 dark:text-neutral-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{plugin.permissions.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
