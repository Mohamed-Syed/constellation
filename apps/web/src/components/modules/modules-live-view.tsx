"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";

import { useLivePlugins, formatAgo } from "@/lib/use-live";
import { ModulesView } from "@/components/modules/modules-view";

/**
 * OR2-2: wraps the static `ModulesView` with a live poll of `/api/plugins` so
 * health badges update automatically. Degrades gracefully — if the core is
 * down, the last snapshot (or the SSR pass) is shown and an inline "stale"
 * indicator appears instead of an error boundary.
 */
export function ModulesLiveView({ initial }: { initial: Parameters<typeof ModulesView>[0]["plugins"] }) {
  const { data, loading, error, lastUpdated } = useLivePlugins();
  const plugins = data ?? initial;

  return (
    <div>
      <div className="mb-4 flex items-center justify-end gap-2 text-xs text-neutral-400 dark:text-neutral-500">
        {error && !data ? (
          <span className="text-amber-600 dark:text-amber-400">Live data unavailable — showing last known state.</span>
        ) : (
          <span aria-live="polite">Live · updated {formatAgo(lastUpdated)}</span>
        )}
        <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
      </div>
      <ModulesView plugins={plugins} />
    </div>
  );
}
