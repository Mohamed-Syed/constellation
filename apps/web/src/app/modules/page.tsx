import type { Metadata } from "next";

import { getPlugins } from "@/lib/api";
import { ModulesLiveView } from "@/components/modules/modules-live-view";

export const metadata: Metadata = { title: "Modules" };

export default async function ModulesPage() {
  const plugins = await getPlugins();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Modules</h1>
        <p className="mt-2 max-w-2xl text-neutral-500 dark:text-neutral-400">
          Every installed plugin appears here automatically. Drop a repository into{" "}
          <code className="rounded bg-neutral-200 px-1 py-0.5 text-sm dark:bg-neutral-800">/plugins</code> with a
          valid manifest and the core discovers it — no code changes.
        </p>
      </header>

      <ModulesLiveView initial={plugins} />
    </div>
  );
}
