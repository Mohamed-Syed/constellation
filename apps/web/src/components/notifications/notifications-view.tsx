"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Download,
  Info,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Reveal } from "@/components/motion/reveal";
import { hasPermission } from "@/lib/permissions";
import { formatRelativeTime } from "@/lib/engine";
import { ChannelsPanel } from "./channels-panel";
import {
  dismissNotification,
  exportAuditCsv,
  fetchAuditEntries,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AuditEntry,
  type NotificationListResult,
  type PlatformNotification,
} from "@/lib/notifications";

/**
 * `/notifications` — Phase 3.0 notification center.
 *
 * Two tabs:
 *  - **Feed** — the durable platform event feed (engine task alerts +
 *    scheduler fires/errors), polled every 10s. Filter chips, click-to-
 *    mark-read, dismiss, mark-all-read, honest empty state.
 *  - **Audit log** — the accountable trail (`GET /api/audit`), admin-only
 *    (core:audit:read). Hidden for non-admins, honest forbidden state.
 *
 * DESIGN_SKILL language: surface cards, Reveal entrances, press-scale
 * buttons, both themes tuned.
 */
const POLL_MS = 10000;

const FILTERS = [
  { id: "all", label: "All", match: () => true },
  { id: "unread", label: "Unread", match: (n: PlatformNotification) => !n.read },
  { id: "task", label: "Tasks", match: (n: PlatformNotification) => n.refType === "task" },
  { id: "schedule", label: "Schedules", match: (n: PlatformNotification) => n.refType === "schedule" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const KIND_LABELS: Record<string, string> = {
  "engine.task.failed": "Task failure",
  "engine.task.stale": "Stale task",
  "engine.task.recovered": "Task recovered",
  "scheduler.schedule.fired": "Schedule fired",
  "scheduler.schedule.error": "Schedule error",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function severityMeta(severity: PlatformNotification["severity"]): { icon: typeof Info; cls: string } {
  switch (severity) {
    case "error":
      return { icon: AlertCircle, cls: "text-rose-600 dark:text-rose-400" };
    case "warning":
      return { icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-400" };
    case "success":
      return { icon: CheckCircle2, cls: "text-emerald-600 dark:text-emerald-400" };
    default:
      return { icon: Info, cls: "text-sky-600 dark:text-sky-400" };
  }
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

export function NotificationsView() {
  const { token, permissions } = useAuth();
  const canReadAudit = hasPermission(permissions, "core:audit:read");
  const canManageChannels = hasPermission(permissions, "platform:admin");

  // Compliance export (Phase 4.0): fetch the CSV, then trigger a download.
  const handleExport = async () => {
    setExporting(true);
    const result = await exportAuditCsv(token);
    setExporting(false);
    if (!result.ok || !result.csv) {
      toast.error(`Export failed: ${result.error ?? "no data"}`);
      return;
    }
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `constellation-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Audit CSV downloaded.");
  };

  const [tab, setTab] = React.useState<string>("feed");
  const [filter, setFilter] = React.useState<FilterId>("all");
  const [result, setResult] = React.useState<NotificationListResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [markingAll, setMarkingAll] = React.useState(false);

  const [audit, setAudit] = React.useState<AuditEntry[] | null>(null);
  const [auditLoading, setAuditLoading] = React.useState(false);
  const [auditForbidden, setAuditForbidden] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  // Feed: poll the durable event feed (keeps the unread count honest too).
  React.useEffect(() => {
    if (!token) return;
    let active = true;
    const load = async () => {
      const res = await fetchNotifications(token, { limit: 100 });
      if (!active) return;
      if (res.state === "ok") {
        setResult(res.data);
        setError(false);
      } else {
        setError(true);
      }
      setLoading(false);
    };
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [token]);

  // Audit tab: lazy-load on first open (admin only).
  // NOTE: `auditLoading` must NOT be in the dependency array — setting it
  // would re-run this effect, whose cleanup flips `active=false` and drops
  // the in-flight fetch result (found LIVE in the browser proof: the tab
  // spun on "Loading audit trail…" forever).
  React.useEffect(() => {
    if (tab !== "audit" || !canReadAudit || !token || audit !== null) return;
    let active = true;
    setAuditLoading(true);
    void fetchAuditEntries(token, 50).then((res) => {
      if (!active) return;
      if (res.state === "ok") setAudit(res.data);
      if (res.state === "forbidden") setAuditForbidden(true);
      setAuditLoading(false);
    });
    return () => {
      active = false;
    };
  }, [tab, canReadAudit, token, audit]);

  const handleRowClick = (n: PlatformNotification) => {
    if (n.read) return;
    setResult((prev) =>
      prev
        ? {
            items: prev.items.map((i) => (i.id === n.id ? { ...i, read: true } : i)),
            unreadCount: Math.max(0, prev.unreadCount - 1),
          }
        : prev,
    );
    if (token) void markNotificationRead(token, n.id);
  };

  const handleDismiss = (n: PlatformNotification) => {
    setResult((prev) =>
      prev
        ? {
            items: prev.items.filter((i) => i.id !== n.id),
            unreadCount: n.read ? prev.unreadCount : Math.max(0, prev.unreadCount - 1),
          }
        : prev,
    );
    if (token) void dismissNotification(token, n.id);
  };

  const handleMarkAll = async () => {
    if (!token || !result || result.unreadCount === 0 || markingAll) return;
    setMarkingAll(true);
    const res = await markAllNotificationsRead(token);
    if (res.state === "ok") {
      setResult((prev) => (prev ? { items: prev.items.map((i) => ({ ...i, read: true })), unreadCount: 0 } : prev));
    }
    setMarkingAll(false);
  };

  const items = result?.items ?? [];
  const visible = FILTERS.find((f) => f.id === filter)?.match ?? (() => true);
  const filtered = items.filter(visible);
  const unreadCount = result?.unreadCount ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Platform events from the engine and scheduler — durable across restarts.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleMarkAll()}
            disabled={unreadCount === 0 || markingAll}
            className="press-scale"
          >
            {markingAll ? <Loader2 className="animate-spin" /> : <CheckCheck />}
            Mark all read
          </Button>
        </div>
      </Reveal>

      <Tabs defaultValue="feed" value={tab} onValueChange={setTab} className="mt-6">
        <TabsList aria-label="Notification center">
          <TabsTrigger value="feed">Feed</TabsTrigger>
          {canReadAudit ? <TabsTrigger value="audit">Audit log</TabsTrigger> : null}
          {canManageChannels ? <TabsTrigger value="channels">Channels</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="feed">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cnFilterChip(filter === f.id)}
              >
                {f.label}
                {f.id === "unread" && unreadCount > 0 ? (
                  <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-fg">
                    {unreadCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {loading ? (
              <Card>
                <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-500 dark:text-neutral-400">
                  <Loader2 className="size-4 animate-spin" /> Loading notifications…
                </CardContent>
              </Card>
            ) : error && items.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  Could not reach the notification center. It will retry automatically.
                </CardContent>
              </Card>
            ) : filtered.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                  <Bell className="size-8 text-neutral-300 dark:text-neutral-600" />
                  <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    {filter === "all" ? "You're all caught up." : "No notifications match this filter."}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {filter === "all"
                      ? "Engine alerts and schedule events will show up here as they happen."
                      : "Try a different filter."}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <ul className="flex flex-col gap-2">
                {filtered.map((n) => (
                  <NotificationRow key={n.id} notification={n} onOpen={handleRowClick} onDismiss={handleDismiss} />
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-neutral-400" /> Audit log
              </CardTitle>
              <CardDescription className="flex items-center justify-between gap-3">
                <span>Accountable trail of platform actions, newest first (admin only).</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleExport()}
                  disabled={exporting}
                  className="shrink-0"
                >
                  {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  Export CSV
                </Button>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auditForbidden ? (
                <p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  You don&apos;t have permission to view the audit log.
                </p>
              ) : auditLoading && audit === null ? (
                <p className="flex items-center justify-center gap-2 py-6 text-sm text-neutral-500 dark:text-neutral-400">
                  <Loader2 className="size-4 animate-spin" /> Loading audit trail…
                </p>
              ) : audit === null || audit.length === 0 ? (
                <p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  No audit entries recorded yet.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-neutral-200/80 dark:divide-white/[0.06]">
                  {audit.map((entry) => (
                    <AuditRow key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="channels">
          <ChannelsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NotificationRow({
  notification: n,
  onOpen,
  onDismiss,
}: {
  notification: PlatformNotification;
  onOpen: (n: PlatformNotification) => void;
  onDismiss: (n: PlatformNotification) => void;
}) {
  const meta = severityMeta(n.severity);
  const Icon = meta.icon;
  return (
    <li>
      <Reveal>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpen(n)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen(n);
            }
          }}
          className={cnRow(n.read)}
        >
          <Icon className={cnIcon(meta.cls)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{n.title}</p>
              {!n.read ? <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="unread" /> : null}
            </div>
            {n.message ? (
              <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{n.message}</p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
              <span className="rounded border border-neutral-200 px-1 py-px font-medium dark:border-white/10">
                {kindLabel(n.kind)}
              </span>
              {n.refType && n.refId ? (
                n.refType === "task" ? (
                  <Link
                    href="/engine"
                    onClick={(e) => e.stopPropagation()}
                    className="rounded px-1 py-px font-mono text-accent hover:underline"
                  >
                    task {shortId(n.refId)}
                  </Link>
                ) : (
                  <span className="rounded px-1 py-px font-mono">schedule {shortId(n.refId)}</span>
                )
              ) : null}
              <span>{formatRelativeTime(n.createdAt)}</span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(n);
            }}
            className="press-scale rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </Reveal>
    </li>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  let metadataText = "";
  try {
    metadataText = JSON.stringify(entry.metadata ?? {});
  } catch {
    metadataText = "";
  }
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs font-medium text-neutral-800 dark:text-neutral-200">{entry.action}</p>
        <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
          {entry.actorId ?? "system"} · {entry.pluginId}
          {metadataText && metadataText !== "{}" ? ` · ${metadataText.slice(0, 120)}` : ""}
        </p>
      </div>
      <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{formatRelativeTime(entry.createdAt)}</span>
    </li>
  );
}

function cnFilterChip(active: boolean): string {
  return [
    "press-scale inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active
      ? "border-accent/30 bg-accent/10 text-accent"
      : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/5",
  ].join(" ");
}

function cnRow(read: boolean): string {
  return [
    "group flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200/80 p-3 transition-colors",
    read
      ? "bg-white/60 dark:border-white/[0.06] dark:bg-white/[0.02]"
      : "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-accent/30 dark:border-white/[0.08] dark:bg-white/[0.04] dark:hover:border-accent/40",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
  ].join(" ");
}

function cnIcon(cls: string): string {
  return `mt-0.5 size-4 shrink-0 ${cls}`;
}
