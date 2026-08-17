"use client";

import * as React from "react";

import type { PluginDetail, PluginSummary } from "@/lib/types";
import { useAuth } from "@/components/auth/auth-provider";
import { API_BASE } from "@/lib/api-base";

/**
 * Poll the core for live plugin data on an interval. Degrades gracefully: if a
 * fetch fails (core down / network error) the previous snapshot is kept and
 * `error` flips to true, so the UI never blanks out or throws mid-poll.
 *
 * This is the OR2-2 "live health" seam. Callers render health badges that
 * update automatically as the core's health poller records new results.
 */

interface LiveState<T> {
  data: T[] | null;
  loading: boolean;
  error: boolean;
  lastUpdated: number | null;
}

function useLiveList<T>(path: string, intervalMs: number): LiveState<T> {
  // Attach the bearer token (if we have one) so this keeps working the
  // moment these read routes get RBAC-guarded; harmless no-op while they're
  // still public (see the note in lib/api.ts).
  const { token } = useAuth();
  const [state, setState] = React.useState<LiveState<T>>({
    data: null,
    loading: true,
    error: false,
    lastUpdated: null,
  });

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        cache: "no-store",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as T[];
      setState({ data, loading: false, error: false, lastUpdated: Date.now() });
    } catch {
      // Keep the last good snapshot; only mark the first load as errored.
      setState((prev) => ({
        data: prev.data,
        loading: false,
        error: prev.data === null,
        lastUpdated: prev.lastUpdated,
      }));
    }
  }, [path, token]);

  React.useEffect(() => {
    let active = true;
    void load();
    const id = setInterval(() => {
      if (active) void load();
    }, intervalMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [load, intervalMs]);

  return state;
}

/** Live list of all plugins (polls `GET /api/plugins`). */
export function useLivePlugins(intervalMs = 15000): LiveState<PluginSummary> {
  return useLiveList<PluginSummary>("/plugins", intervalMs);
}

/** Live single-plugin detail (polls `GET /api/plugins/:id`). */
export function useLivePluginDetail(
  id: string | undefined,
  intervalMs = 15000,
): LiveState<PluginDetail> & { notFound: boolean } {
  const { token } = useAuth();
  const [state, setState] = React.useState<LiveState<PluginDetail>>({
    data: null,
    loading: true,
    error: false,
    lastUpdated: null,
  });
  const [notFound, setNotFound] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API_BASE}/plugins/${encodeURIComponent(id)}`, {
        cache: "no-store",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.status === 404) {
        setNotFound(true);
        setState((prev) => ({ ...prev, loading: false, error: false }));
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PluginDetail;
      setNotFound(false);
      setState({ data: [data], loading: false, error: false, lastUpdated: Date.now() });
    } catch {
      setState((prev) => ({
        data: prev.data,
        loading: false,
        error: prev.data === null,
        lastUpdated: prev.lastUpdated,
      }));
    }
  }, [id, token]);

  React.useEffect(() => {
    let active = true;
    setNotFound(false);
    void load();
    const timer = setInterval(() => {
      if (active) void load();
    }, intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load, intervalMs]);

  return { ...state, notFound };
}

/**
 * Human "time ago" for a timestamp. Accepts an epoch ms number OR an ISO
 * string (both appear across the portal) — `null`/falsy → "never".
 */
export function formatAgo(timestamp: number | string | null): string {
  if (!timestamp) return "never";
  const ms = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  if (Number.isNaN(ms)) return "never";
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
