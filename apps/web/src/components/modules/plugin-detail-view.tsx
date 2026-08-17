"use client";

import * as React from "react";
import {
  AlertTriangle,
  Flag,
  KeyRound,
  Plug,
  Route,
  Settings2,
  Wrench,
} from "lucide-react";

import type { PluginDetail, PluginHealth } from "@/lib/types";
import { cn } from "@/lib/utils";
import { resolveIcon } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  HealthDot,
  healthBadgeVariant,
  healthLabel,
  stateBadgeVariant,
  stateLabel,
} from "@/components/modules/plugin-state";
import { PluginToolsPanel } from "@/components/modules/plugin-tools-panel";

function SectionHeading({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="size-4 text-neutral-400 dark:text-neutral-500" />
      <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{title}</h3>
      {typeof count === "number" ? (
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          {count}
        </span>
      ) : null}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-neutral-300 px-3 py-4 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
      {children}
    </p>
  );
}

function HealthBadge({ health }: { health: PluginHealth | null | undefined }) {
  if (!health) {
    return (
      <Badge variant="neutral" className="gap-1.5">
        <HealthDot health="down" />
        No health data
      </Badge>
    );
  }
  return (
    <Badge variant={healthBadgeVariant(health)} className="gap-1.5">
      <HealthDot health={health.status} />
      {healthLabel(health)}
    </Badge>
  );
}

function lastCheckedLabel(iso: string | null | undefined): string {
  if (!iso) return "not polled yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `last checked ${d.toLocaleTimeString()}`;
}

export function PluginDetailView({ plugin, defaultTab }: { plugin: PluginDetail; defaultTab?: "overview" | "access" | "behavior" | "tools" }) {
  const Icon = resolveIcon(plugin.navigation?.[0]?.icon);
  const initialTab =
    defaultTab && (defaultTab !== "tools" || plugin.tools.length > 0) ? defaultTab : "overview";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{plugin.name}</h1>
            <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
              {plugin.id} · v{plugin.version}
            </p>
            {plugin.description ? (
              <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-neutral-300">{plugin.description}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={stateBadgeVariant(plugin.state)}>{stateLabel(plugin.state)}</Badge>
          <HealthBadge health={plugin.health} />
        </div>
      </div>

      <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">{lastCheckedLabel(plugin.healthCheckedAt)}</p>

      {plugin.error ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="break-words">{plugin.error}</span>
        </div>
      ) : null}

      {/* Tabs */}
      <Tabs defaultValue={initialTab} className="mt-6">
        <TabsList aria-label="Plugin detail sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
          <TabsTrigger value="behavior">Behavior</TabsTrigger>
          {plugin.tools.length > 0 ? <TabsTrigger value="tools">Tools</TabsTrigger> : null}
        </TabsList>

        {/* Overview: identity + permissions + routes */}
        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Identity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <DetailRow label="ID" value={plugin.id} mono />
                <DetailRow label="Author" value={plugin.author || "—"} />
                <DetailRow label="License" value={plugin.license} />
                <DetailRow label="Min platform" value={plugin.minPlatformVersion} mono />
                <DetailRow label="Manifest v" value={String(plugin.manifestVersion)} mono />
                {plugin.homepage ? <DetailRow label="Homepage" value={plugin.homepage} link /> : null}
                {plugin.repository ? <DetailRow label="Repository" value={plugin.repository} link /> : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compatibility</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Required services</p>
                  {plugin.requiredServices.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {plugin.requiredServices.map((s) => (
                        <Badge key={s} variant="neutral">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-neutral-500 dark:text-neutral-400">None declared.</p>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Dependencies</p>
                  {plugin.dependencies.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {plugin.dependencies.map((d) => (
                        <Badge key={d} variant="neutral">
                          {d}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-neutral-500 dark:text-neutral-400">No plugin dependencies.</p>
                  )}
                </div>
                <DetailRow label="DB schema" value={plugin.databaseSchema ?? plugin.id} mono />
                {plugin.databaseVersion ? <DetailRow label="DB version" value={plugin.databaseVersion} mono /> : null}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Access: permissions + routes + feature flags */}
        <TabsContent value="access">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <SectionHeading icon={KeyRound} title="Permissions" count={plugin.permissions.length} />
              </CardHeader>
              <CardContent className="pt-0">
                {plugin.permissions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {plugin.permissions.map((p) => (
                      <Badge key={p} variant="neutral" className="font-mono text-xs">
                        {p}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <EmptyHint>No permissions requested.</EmptyHint>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <SectionHeading icon={Route} title="Routes" count={plugin.routes.length} />
              </CardHeader>
              <CardContent className="pt-0">
                {plugin.routes.length > 0 ? (
                  <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                    {plugin.routes.map((r, i) => (
                      <li key={`${r.method}-${r.path}-${i}`} className="flex items-center gap-3 py-2 text-sm">
                        <Badge variant="accent" className="font-mono text-[10px] uppercase">
                          {r.method}
                        </Badge>
                        <code className="font-mono text-xs text-neutral-700 dark:text-neutral-300">{r.path}</code>
                        {r.public ? (
                          <Badge variant="warning" className="ml-auto">
                            public
                          </Badge>
                        ) : (
                          <Badge variant="neutral" className="ml-auto">
                            {r.requiresPermissions.length} perm
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyHint>No routes declared.</EmptyHint>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <SectionHeading icon={Flag} title="Feature flags" count={plugin.featureFlags.length} />
              </CardHeader>
              <CardContent className="pt-0">
                {plugin.featureFlags.length > 0 ? (
                  <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                    {plugin.featureFlags.map((f) => (
                      <li key={f.key} className="flex items-center gap-3 py-2 text-sm">
                        <code className="font-mono text-xs text-neutral-700 dark:text-neutral-300">{f.key}</code>
                        <span className="text-neutral-500 dark:text-neutral-400">{f.description || "—"}</span>
                        <Badge variant={f.default ? "success" : "neutral"} className="ml-auto">
                          default {f.default ? "on" : "off"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyHint>No feature flags declared.</EmptyHint>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Behavior: settings + jobs + navigation */}
        <TabsContent value="behavior">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <SectionHeading icon={Settings2} title="Settings" count={plugin.settings.length} />
              </CardHeader>
              <CardContent className="pt-0">
                {plugin.settings.length > 0 ? (
                  <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                    {plugin.settings.map((s) => (
                      <li key={s.key} className="py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-xs text-neutral-700 dark:text-neutral-300">{s.key}</code>
                          <Badge variant="neutral" className="text-[10px] uppercase">
                            {s.type}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-neutral-500 dark:text-neutral-400">{s.description || "—"}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyHint>No settings exposed.</EmptyHint>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <SectionHeading icon={Wrench} title="Jobs" count={plugin.jobs.length} />
              </CardHeader>
              <CardContent className="pt-0">
                {plugin.jobs.length > 0 ? (
                  <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                    {plugin.jobs.map((j) => (
                      <li key={j.name} className="flex items-center gap-3 py-2 text-sm">
                        <span className="font-medium">{j.name}</span>
                        <span className="text-neutral-500 dark:text-neutral-400">{j.description || "—"}</span>
                        {j.schedule ? (
                          <code className="ml-auto font-mono text-xs text-neutral-500 dark:text-neutral-400">{j.schedule}</code>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyHint>No jobs registered.</EmptyHint>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <SectionHeading icon={Plug} title="Navigation contributions" count={plugin.navigation.length} />
              </CardHeader>
              <CardContent className="pt-0">
                {plugin.navigation.length > 0 ? (
                  <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                    {plugin.navigation.map((n) => (
                      <li key={n.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="font-medium">{n.label}</span>
                        <code className="font-mono text-xs text-neutral-500 dark:text-neutral-400">{n.path}</code>
                        {n.requiresPermissions.length > 0 ? (
                          <Badge variant="neutral" className="ml-auto">
                            {n.requiresPermissions.length} perm
                          </Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyHint>No navigation items.</EmptyHint>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tools: agent-plane capabilities + invoke form */}
        {plugin.tools.length > 0 ? (
          <TabsContent value="tools">
            <PluginToolsPanel plugin={plugin} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  link,
}: {
  label: string;
  value: string;
  mono?: boolean;
  link?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      {link ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer noopener"
          className="truncate text-accent hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className={cn("max-w-[60%] truncate text-right", mono && "font-mono text-xs")}>{value}</span>
      )}
    </div>
  );
}
