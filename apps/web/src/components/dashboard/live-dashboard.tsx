"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Blocks, CheckCircle2, RefreshCw, XCircle } from "lucide-react";

import type { PluginSummary } from "@/lib/types";
import { useLivePlugins, formatAgo } from "@/lib/use-live";
import { resolveIcon } from "@/lib/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/motion/reveal";
import { stateBadgeVariant, stateLabel } from "@/components/modules/plugin-state";

/**
 * OR2-2 + OR2-3: live dashboard. Polls `/api/plugins` so the platform summary
 * (healthy / degraded / down) stays current, and links recent modules to the new
 * detail page. Degrades gracefully when the core is unreachable.
 */
export function LiveDashboard({ initial }: { initial: PluginSummary[] }) {
  const { data, loading, error, lastUpdated } = useLivePlugins();
  const plugins = data ?? initial;

  const healthy = plugins.filter(
    (p) => p.health?.status === "ok" || (!p.health && p.state === "enabled"),
  );
  const degraded = plugins.filter((p) => p.health?.status === "degraded");
  const down = plugins.filter((p) => p.health?.status === "down" || p.state === "failed");

  /** Category key -> the plugins that belong to it. 'all' = every module. */
  const buckets: Record<string, PluginSummary[]> = {
    all: plugins,
    healthy,
    degraded,
    down,
  };
  // Clicking a category card drills the module list below to THAT category.
  // 'all' is the default view (every module), matching the current behavior.
  const [active, setActive] = React.useState<string>("all");

  const stats = [
    { key: "all", label: "Modules loaded", value: plugins.length, icon: Blocks },
    { key: "healthy", label: "Healthy", value: healthy.length, icon: CheckCircle2 },
    { key: "degraded", label: "Degraded", value: degraded.length, icon: AlertTriangle },
    { key: "down", label: "Down / failed", value: down.length, icon: XCircle },
  ];

  const visible = buckets[active] ?? plugins;

  return (
    <Reveal className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
            <span className="size-1.5 rounded-full bg-accent" />
            Constellation Platform · v0.1.0
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard</h1>
          <p className="mt-2 max-w-2xl text-neutral-500 dark:text-neutral-400">
            A single pane of glass over every module running in this environment.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          <span aria-live="polite">
            {error && !data ? "Live data unavailable" : `Live · ${formatAgo(lastUpdated)}`}
          </span>
        </div>
      </header>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, i) => {
          const isActive = active === stat.key;
          return (
            <Reveal key={stat.key} delay={i * 0.05}>
              <button
                type="button"
                onClick={() => setActive(isActive ? "all" : stat.key)}
                aria-pressed={isActive}
                title={`Show the ${stat.value} module(s) in this category`}
                className={[
                  "w-full cursor-pointer rounded-xl text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  // daisyUI/taste-skill affordance: hover lift + ring + clear press feedback
                  isActive
                    ? "ring-2 ring-accent/60 shadow-md"
                    : "ring-1 ring-neutral-200 hover:ring-accent/40 hover:shadow-md dark:ring-white/10",
                ].join(" ")}
              >
                <Card className={isActive ? "border-accent/60 bg-base-200/40" : "surface-hover"}>
                  <CardContent className="flex items-center justify-between p-5">
                    <div>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">{stat.label}</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</p>
                    </div>
                    <span className="flex size-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <stat.icon className="size-5" />
                    </span>
                  </CardContent>
                </Card>
              </button>
            </Reveal>
          );
        })}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>
              {active === "all"
                ? "Recently loaded modules"
                : `${active === "healthy" ? "Healthy" : active === "degraded" ? "Degraded" : "Down / failed"} modules (${visible.length})`}
            </CardTitle>
            <CardDescription>
              {active === "all"
                ? "The core discovers these automatically from `/plugins`."
                : `Click any summary card above to filter — showing the ${active} ones.`}
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/modules">
              View all
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {plugins.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              No modules loaded yet, or the core API isn&apos;t running.
              <div className="mt-2 text-xs">
                Start it with{" "}
                <code className="rounded bg-neutral-200 px-1 py-0.5 dark:bg-neutral-800">
                  pnpm --filter @constellation/api dev
                </code>{" "}
                on port 4001.
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              No modules in this category right now.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {visible.slice(0, active === "all" ? 5 : 50).map((plugin) => {
                const NavIcon = resolveIcon(plugin.navigation?.[0]?.icon);
                const healthText =
                  plugin.health?.status === "degraded"
                    ? " · degraded"
                    : plugin.health?.status === "down"
                      ? " · down"
                      : "";
                return (
                  <li key={plugin.id}>
                    <Link
                      href={`/modules/${plugin.id}`}
                      className="flex items-center gap-3 py-3 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-neutral-800/50"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        <NavIcon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {plugin.name}
                          {healthText && (
                            <span className="ml-1 text-xs font-normal text-neutral-400">{healthText}</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{plugin.id}</p>
                      </div>
                      <Badge variant={stateBadgeVariant(plugin.state)}>{stateLabel(plugin.state)}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </Reveal>
  );
}
