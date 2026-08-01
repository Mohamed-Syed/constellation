"use client";

import * as React from "react";
import Link from "next/link";
import { Activity, ClipboardList, Lock, Search, ShieldCheck, Users } from "lucide-react";

import type { PlatformHealth, PluginState, PluginSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resolveIcon } from "@/lib/icons";
import {
  healthBadgeVariant,
  healthLabel,
  stateBadgeVariant,
  stateLabel,
} from "@/components/modules/plugin-state";

type StateFilter = "all" | PluginState;
type HealthFilter = "all" | "ok" | "degraded" | "down" | "unknown";

function PlatformSummary({ health }: { health: PlatformHealth | null }) {
  const cards = [
    {
      label: "Platform status",
      value: health ? (health.status === "ok" ? "Operational" : "Degraded") : "Unknown",
      icon: Activity,
      tone: health?.status === "ok" ? "success" : health?.status === "degraded" ? "warning" : "neutral",
    },
    {
      label: "Plugins total",
      value: health?.plugins.total ?? "—",
      icon: ClipboardList,
      tone: "neutral" as const,
    },
    {
      label: "Failed",
      value: health?.plugins.failed ?? "—",
      icon: ShieldCheck,
      tone: (health?.plugins.failed ?? 0) > 0 ? ("danger" as const) : ("success" as const),
    },
    {
      label: "Uptime",
      value: health ? `${Math.floor(health.uptimeSeconds / 60)}m` : "—",
      icon: Users,
      tone: "neutral" as const,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{c.label}</p>
              <p className="mt-1 text-xl font-semibold">{c.value}</p>
            </div>
            <span className="flex size-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <c.icon className="size-5" />
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StatePill({ state }: { state: PluginState }) {
  return <Badge variant={stateBadgeVariant(state)}>{stateLabel(state)}</Badge>;
}

function HealthPill({ plugin }: { plugin: PluginSummary }) {
  if (!plugin.health) {
    return <span className="text-xs text-neutral-400 dark:text-neutral-500">unknown</span>;
  }
  return <Badge variant={healthBadgeVariant(plugin.health)}>{healthLabel(plugin.health)}</Badge>;
}

export function AdminConsole({
  health,
  plugins,
}: {
  health: PlatformHealth | null;
  plugins: PluginSummary[];
}) {
  const [query, setQuery] = React.useState("");
  const [stateFilter, setStateFilter] = React.useState<StateFilter>("all");
  const [healthFilter, setHealthFilter] = React.useState<HealthFilter>("all");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return plugins.filter((p) => {
      if (stateFilter !== "all" && p.state !== stateFilter) return false;
      const hp = p.health?.status ?? "unknown";
      if (healthFilter !== "all" && hp !== healthFilter) return false;
      if (q && !`${p.name} ${p.id} ${p.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [plugins, query, stateFilter, healthFilter]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Admin</h1>
        <p className="mt-2 text-neutral-500 dark:text-neutral-400">
          Platform administration. Gated behind RBAC once auth ships — every panel below is a preview of the
          roadmap phase P2.
        </p>
      </header>

      <div className="mb-8">
        <PlatformSummary health={health} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plugin registry</CardTitle>
          <CardDescription>
            {plugins.length} module{plugins.length === 1 ? "" : "s"} discovered. Use filters to triage by state or health.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search modules…"
                className="pl-8"
                aria-label="Search modules"
              />
            </div>

            <FilterSelect
              label="State"
              value={stateFilter}
              onChange={(v) => setStateFilter(v as StateFilter)}
              options={[
                { value: "all", label: "All states" },
                { value: "enabled", label: "Enabled" },
                { value: "disabled", label: "Disabled" },
                { value: "failed", label: "Failed" },
                { value: "registered", label: "Registered" },
                { value: "validated", label: "Validated" },
                { value: "discovered", label: "Discovered" },
              ]}
            />
            <FilterSelect
              label="Health"
              value={healthFilter}
              onChange={(v) => setHealthFilter(v as HealthFilter)}
              options={[
                { value: "all", label: "All health" },
                { value: "ok", label: "Healthy" },
                { value: "degraded", label: "Degraded" },
                { value: "down", label: "Down" },
                { value: "unknown", label: "Unknown" },
              ]}
            />
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              No modules match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Module</th>
                    <th className="px-4 py-3 font-medium">State</th>
                    <th className="px-4 py-3 font-medium">Health</th>
                    <th className="px-4 py-3 font-medium">Permissions</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {filtered.map((plugin) => {
                    const Icon = resolveIcon(plugin.navigation?.[0]?.icon);
                    return (
                      <tr key={plugin.id} className="bg-white dark:bg-neutral-900">
                        <td className="px-4 py-3">
                          <Link
                            href={`/modules/${plugin.id}`}
                            className="flex items-center gap-2.5 rounded outline-none transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                              <Icon className="size-3.5" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium">{plugin.name}</p>
                              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{plugin.id}</p>
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <StatePill state={plugin.state} />
                        </td>
                        <td className="px-4 py-3">
                          <HealthPill plugin={plugin} />
                        </td>
                        <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{plugin.permissions.length}</td>
                        <td className="px-4 py-3 text-right">
                          <PluginActions plugin={plugin} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0">
          {label}: {options.find((o) => o.value === value)?.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => onChange(o.value)}
            className={cn(o.value === value && "bg-neutral-100 dark:bg-neutral-800")}
          >
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Enable/disable controls. The mutating endpoints (`POST /api/plugins/:id/enable|disable`)
 * land with the admin + RBAC layer in P2 and are NOT implemented yet, so the
 * buttons are intentionally disabled with a "coming soon" tooltip. We do NOT
 * invent endpoints (per the round-2 spec). The icons render so the affordance
 * is visible and the transition to real wiring is a one-line change later.
 */
function PluginActions({ plugin }: { plugin: PluginSummary }) {
  const isEnabled = plugin.state === "enabled";
  return (
    <div className="flex items-center justify-end gap-1" title="Enable / disable ships with the admin + RBAC layer (P2)">
      <Button
        variant="ghost"
        size="sm"
        disabled
        aria-disabled="true"
        className="cursor-not-allowed opacity-50"
      >
        <Lock className="size-3.5" />
        {isEnabled ? "Disable" : "Enable"}
      </Button>
      <span className="text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        coming soon
      </span>
    </div>
  );
}
