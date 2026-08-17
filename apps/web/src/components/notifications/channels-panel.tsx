"use client";

import * as React from "react";
import { BellRing, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deleteNotificationChannel,
  fetchNotificationChannels,
  testNotificationChannel,
  upsertNotificationChannel,
  type NotificationChannel,
} from "@/lib/notifications";

/**
 * Channels panel (Phase 3.0 — notification channels round): configure the
 * outbound webhook delivery for the event feed (generic / Slack / Discord /
 * Teams envelopes), pick which kinds each channel receives (empty = all),
 * enable/disable, test, delete. Admin-gated (platform:admin).
 */
const KNOWN_KINDS = [
  "engine.task.failed",
  "engine.task.stale",
  "engine.task.recovered",
  "engine.task.completed",
  "engine.task.paused",
  "scheduler.schedule.fired",
  "scheduler.schedule.error",
];

const FORMATS = ["generic", "slack", "discord", "teams"] as const;

export function ChannelsPanel() {
  const { token } = useAuth();
  const [channels, setChannels] = React.useState<NotificationChannel[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [testing, setTesting] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);

  // Add form
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [format, setFormat] = React.useState<NotificationChannel["format"]>("generic");
  const [kinds, setKinds] = React.useState<string[]>([]);
  const [allKinds, setAllKinds] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!token) return;
    const res = await fetchNotificationChannels(token);
    if (res.state === "ok") {
      setChannels(res.data);
      setError(false);
    } else {
      setError(true);
    }
    setLoading(false);
  }, [token]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const toggleKind = (kind: string) => {
    setAllKinds(false);
    setKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  };

  const handleSave = async () => {
    if (!token || saving) return;
    if (!name.trim() || !/^https?:\/\//.test(url.trim())) {
      toast.error("A channel name and an http(s) webhook URL are required.");
      return;
    }
    setSaving(true);
    const res = await upsertNotificationChannel(token, {
      name: name.trim(),
      url: url.trim(),
      format,
      kinds: allKinds ? [] : kinds,
      enabled: true,
    });
    if (res.state === "ok") {
      toast.success(`Channel "${res.data.channel.name}" saved.`);
      setName("");
      setUrl("");
      setFormat("generic");
      setKinds([]);
      setAllKinds(true);
      void load();
    } else {
      toast.error(res.state === "forbidden" ? "You don't have permission to manage channels." : res.message);
    }
    setSaving(false);
  };

  const handleTest = async (channel: NotificationChannel) => {
    if (!token) return;
    setTesting(channel.id);
    const res = await testNotificationChannel(token, channel.id);
    if (res.state === "ok" && res.data.ok) {
      toast.success(`Test message delivered to "${channel.name}".`);
    } else {
      toast.error(`Test failed for "${channel.name}": ${res.state === "ok" ? (res.data.error ?? `HTTP ${res.data.status}`) : res.message}`);
    }
    setTesting(null);
  };

  const handleDelete = async (channel: NotificationChannel) => {
    if (!token) return;
    setDeleting(channel.id);
    const res = await deleteNotificationChannel(token, channel.id);
    if (res.state === "ok") {
      toast.success(`Channel "${channel.name}" removed.`);
      void load();
    } else {
      toast.error(res.state === "forbidden" ? "You don't have permission to manage channels." : res.message);
    }
    setDeleting(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="size-4 text-neutral-400" /> Add webhook
          </CardTitle>
          <CardDescription>
            Every matching event is POSTed to the URL (generic JSON, or a Slack / Discord / Teams-shaped body).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Channel name (e.g. ops-alerts)"
              aria-label="Channel name"
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 dark:border-white/10 dark:bg-neutral-900"
            />
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as NotificationChannel["format"])}
              aria-label="Webhook format"
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent dark:border-white/10 dark:bg-neutral-900"
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/… or any webhook URL"
            aria-label="Webhook URL"
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 dark:border-white/10 dark:bg-neutral-900"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
              <input type="checkbox" checked={allKinds} onChange={(e) => setAllKinds(e.target.checked)} className="accent-accent" />
              All events
            </label>
            {KNOWN_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                <input
                  type="checkbox"
                  checked={!allKinds && kinds.includes(kind)}
                  disabled={allKinds}
                  onChange={() => toggleKind(kind)}
                  className="accent-accent"
                />
                <span className="font-mono">{kind}</span>
              </label>
            ))}
          </div>
          <div>
            <Button onClick={() => void handleSave()} disabled={saving} className="press-scale">
              {saving ? <Loader2 className="animate-spin" /> : <Plus />}
              Save channel
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configured channels</CardTitle>
          <CardDescription>Delivered fire-and-forget — a failing webhook never breaks the feed.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-neutral-500 dark:text-neutral-400">
              <Loader2 className="size-4 animate-spin" /> Loading channels…
            </p>
          ) : error && channels === null ? (
            <p className="py-6 text-sm text-neutral-500 dark:text-neutral-400">Could not load channels — retry.</p>
          ) : channels === null || channels.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
              No channels configured yet. Add a webhook above to start receiving events.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-200/80 dark:divide-white/[0.06]">
              {channels.map((channel) => (
                <li key={channel.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                      {channel.name}
                      <span
                        className={[
                          "rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider",
                          channel.enabled
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-neutral-500/10 text-neutral-500",
                        ].join(" ")}
                      >
                        {channel.enabled ? "enabled" : "disabled"}
                      </span>
                      <span className="rounded border border-neutral-200 px-1.5 py-px font-mono text-[10px] text-neutral-400 dark:border-white/10">
                        {channel.format}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">{channel.url}</p>
                    <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                      {channel.kinds.length === 0 ? "All events" : channel.kinds.join(", ")}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTest(channel)}
                    disabled={testing === channel.id}
                    className="press-scale"
                  >
                    {testing === channel.id ? <Loader2 className="animate-spin" /> : <Send />}
                    Test
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDelete(channel)}
                    disabled={deleting === channel.id}
                    className="press-scale text-rose-600 hover:text-rose-700 dark:text-rose-400"
                  >
                    {deleting === channel.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
