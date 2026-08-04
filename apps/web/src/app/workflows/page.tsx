import type { Metadata } from "next";

import { WorkflowsView } from "@/components/workflows/workflows-view";

export const metadata: Metadata = { title: "Workflows" };

/**
 * Phase 3.0 — visual workflow builder. Server shell; the client view fetches
 * the workflow list + runs itself (the API requires core:workflow:manage).
 */
export default function WorkflowsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Workflows</h1>
        <p className="mt-2 max-w-2xl text-neutral-500 dark:text-neutral-400">
          Compose multi-step agent workflows visually: chain agent tasks and plugin tool
          calls, pipe each step&apos;s result into the next with{" "}
          <code className="rounded bg-neutral-200 px-1 py-0.5 text-sm dark:bg-neutral-800">{"{{steps.<id>.result}}"}</code>,{" "}
          then run them on demand.
        </p>
      </header>
      <WorkflowsView />
    </div>
  );
}
