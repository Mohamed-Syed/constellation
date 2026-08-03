"use client";

import * as React from "react";
import Link from "next/link";
import { Activity, Boxes, ClipboardList, Loader2, Lock, Search, ShieldCheck, Users } from "lucide-react";

import type { PlatformHealth, PluginState, PluginSummary } from "@/lib/types";
import type { FederatedTool } from "@/lib/federated";
import { fetchFederatedModules } from "@/lib/federated";
import { cn } from "@/lib/utils";
import { getPlugins } from "@/lib/api";
import { disablePlugin, enablePlugin } from "@/lib/plugin-actions";
import { hasAnyPermission } from "@/lib/permissions";
import { useAuth } from "@/components/auth/auth-provider";
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
import { Reveal } from "@/components/motion/reveal";
import {
  healthBadgeVariant,
  healthLabel,
  stateBadgeVariant,
  stateLabel,
} from "@/components/modules/plugin-state";

/** Either permission unlocks plugin enable/disable — matches `lib/nav.ts`'s Admin nav gate. */
const MANAGE_PLUGINS_PERMISSIONS = ["core:plugin:manage", "platform:admin"];

type StateFilter = "all" | PluginState;
type HealthFilter = "all" | "ok" | "degraded" | "down" | "unknown";

function PlatformSummary({ health, federated }: { health: PlatformHealth | null; federated: FederatedTool[] }) {
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
      label: "Federated tools",
      value: federated.length === 0 ? "—" : `${federated.length}`,
      icon: Boxes,
      tone: federated.length === 0 ? ("neutral" as const) : ("success" as const),
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
        <Card key={c.label} className="surface-hover">
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
  plugins: initialPlugins,
}: {
  health: PlatformHealth | null;
  plugins: PluginSummary[];
}) {
  const { token, permissions } = useAuth();
  const canManagePlugins = hasAnyPermission(permissions, MANAGE_PLUGINS_PERMISSIONS);

  const [query, setQuery] = React.useState("");
  const [stateFilter, setStateFilter] = React.useState<StateFilter>("all");
  const [healthFilter, setHealthFilter] = React.useState<HealthFilter>("all");

  // Local, mutable copy so enable/disable can update optimistically. Re-seed
  // whenever the SSR/parent snapshot changes (e.g. a client-side nav refetch).
  const [plugins, setPlugins] = React.useState(initialPlugins);
  React.useEffect(() => setPlugins(initialPlugins), [initialPlugins]);

  const [pendingIds, setPendingIds] = React.useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});

  // Federated catalog is authenticated — fetch it client-side with the bearer
  // token (the /api/federation/modules route requires auth). Degrades to [].
  const [federated, setFederated] = React.useState<FederatedTool[]>([]);
  React.useEffect(() => {
    let active = true;
    void fetchFederatedModules(token).then((m) => {
      if (active) setFederated(m);
    });
    return () => {
      active = false;
    };
  }, [token]);

  const handleToggle = React.useCallback(
    async (plugin: PluginSummary) => {
      const goingToEnable = plugin.state !== "enabled";
      const previousSnapshot = plugins;

      setRowErrors((prev) => {
        if (!(plugin.id in prev)) return prev;
        const next = { ...prev };
        delete next[plugin.id];
        return next;
      });
      setPendingIds((prev) => new Set(prev).add(plugin.id));
      // Optimistic update: flip the state immediately.
      setPlugins((prev) =>
        prev.map((p) => (p.id === plugin.id ? { ...p, state: (goingToEnable ? "enabled" : "disabled") as PluginState } : p)),
      );

      const outcome = goingToEnable ? await enablePlugin(plugin.id, token) : await disablePlugin(plugin.id, token);

      if (outcome.ok) {
        // Adopt the server's canonical summary for this row, then refetch
        // the full list so any downstream effects (dependents, health)
        // settle. A failed/empty refetch just keeps what we already applied.
        setPlugins((prev) => prev.map((p) => (p.id === plugin.id ? outcome.plugin : p)));
        const fresh = await getPlugins(token ?? undefined);
        if (fresh.length > 0) setPlugins(fresh);
      } else {
        // Revert to the pre-optimistic snapshot and surface the error inline.
        setPlugins(previousSnapshot);
        setRowErrors((prev) => ({ ...prev, [plugin.id]: outcome.message }));
      }
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(plugin.id);
        return next;
      });
    },
    [plugins, token],
  );

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
    <Reveal className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Admin</h1>
        <p className="mt-2 text-neutral-500 dark:text-neutral-400">
          Platform administration.{" "}
          {canManagePlugins
            ? "You hold core:plugin:manage — enable/disable is live below."
            : "Enable/disable requires the core:plugin:manage permission; you have read-only access."}
        </p>
      </header>

      <div className="mb-8">
        <PlatformSummary health={health} federated={federated} />
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
                          <PluginActions
                            plugin={plugin}
                            canManage={canManagePlugins}
                            pending={pendingIds.has(plugin.id)}
                            error={rowErrors[plugin.id]}
                            onToggle={() => void handleToggle(plugin)}
                          />
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

      <div className="mt-8">
        <FederationReadiness catalog={federated} />
      </div>
    </Reveal>
  );
}

/**
 * Federation readiness (P3 portal federation depth). Shows the live federated
 * module catalog fetched from `GET /api/federation/modules`. SSO + reverse proxy
 * are configured in the API's `config/modules.yaml` / docker-compose — this is a
 * read-only posture view. No endpoints are invented here.
 */
function FederationReadiness({ catalog }: { catalog: FederatedTool[] }) {
  const ssoCount = catalog.filter((m) => m.sso).length;
  const embeddableCount = catalog.filter((m) => m.embeddable).length;
  const gatedCount = catalog.filter((m) => m.requiresPermissions.length > 0).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Federated tools</CardTitle>
        <CardDescription>
          Heavyweight platforms surfaced as tiles on the <Link href="/tools" className="text-accent hover:underline">Tools</Link> page, sourced live from the API&apos;s federation registry.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Modules</p>
            <p className="mt-0.5 font-medium">{catalog.length}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-400 dark:text-neutral-500">SSO</p>
            <p className="mt-0.5 font-medium">{ssoCount}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Embeddable</p>
            <p className="mt-0.5 font-medium">{embeddableCount}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Permission-gated</p>
            <p className="mt-0.5 font-medium">{gatedCount}</p>
          </div>
        </div>
        {catalog.length === 0 ? (
          <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
            No federated modules returned. Add entries to the API&apos;s <code>config/modules.yaml</code> and restart the core.
          </p>
        ) : null}
      </CardContent>
    </Card>
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
 * Enable/disable controls (Orion P2 task 3), wired to
 * `POST /api/plugins/:id/enable|disable` with the caller's bearer token.
 * Only rendered as functional buttons when the user holds
 * `core:plugin:manage`/`platform:admin` — everyone else sees a read-only
 * lock affordance instead, matching the nav gate in `lib/nav.ts`.
 */
function PluginActions({
  plugin,
  canManage,
  pending,
  error,
  onToggle,
}: {
  plugin: PluginSummary;
  canManage: boolean;
  pending: boolean;
  error?: string;
  onToggle: () => void;
}) {
  const isEnabled = plugin.state === "enabled";

  if (!canManage) {
    return (
      <span
        className="inline-flex items-center justify-end gap-1.5 text-xs text-neutral-400 dark:text-neutral-500"
        title="Requires the core:plugin:manage permission"
      >
        <Lock className="size-3.5" />
        Read-only
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={isEnabled ? "outline" : "default"}
        size="sm"
        disabled={pending}
        aria-busy={pending}
        onClick={onToggle}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {isEnabled ? "Disable" : "Enable"}
      </Button>
      {error ? (
        <span role="alert" className="max-w-[180px] text-right text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </span>
      ) : null}
    </div>
  );
}
