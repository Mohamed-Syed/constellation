"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { probeApiIdentity, type IdentityProbe } from "@/lib/api-base";

/**
 * D-2 startup identity assertion (Engine v0.1 Task 4).
 *
 * On mount, probes GET /api/identity on the configured API base. If the API
 * does NOT identify as `{ product: "constellation" }` — a foreign process
 * squatting the port, a stale deployment, a 404 — it renders a clear amber
 * banner ("Connected to the wrong API on <url> — expected Constellation")
 * instead of silently rendering another product's data. When the identity
 * checks out it renders nothing (no visual noise on the happy path).
 *
 * Rendered in the shell so it appears on every portal page, including login.
 */
export function IdentityBanner() {
  const [probe, setProbe] = React.useState<IdentityProbe | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void probeApiIdentity().then((result) => {
      if (!cancelled) setProbe(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Wait for the probe; render nothing until we know.
  if (!probe) return null;
  if (probe.ok) return null;

  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span>
        Connected to the wrong API on <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs dark:bg-amber-900/60">{probe.url}</code>
        {probe.product ? (
          <>
            {" "}
            — that server identifies as <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs dark:bg-amber-900/60">{probe.product}</code>,
            expected <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs dark:bg-amber-900/60">constellation</code>.
          </>
        ) : (
          " — that server did not identify as Constellation. Expected the API published on port 4001."
        )}
      </span>
      <span className="ml-auto flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
        <CheckCircle2 className="size-3" aria-hidden />
        probe /api/identity
      </span>
    </div>
  );
}
