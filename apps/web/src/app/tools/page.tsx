import type { Metadata } from "next";
import { Boxes, ServerCrash } from "lucide-react";

import { getFederatedTools } from "@/lib/federated-api";
import type { FederatedCatalog } from "@/lib/federated-tools";
import { FederatedToolTile } from "@/components/modules/federated-tool-tile";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Tools" };

function groupByCategory(tools: FederatedCatalog["tools"]): Map<string, FederatedCatalog["tools"]> {
  const groups = new Map<string, FederatedCatalog["tools"]>();
  for (const t of tools) {
    const key = t.category ?? "General";
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  return groups;
}

export default async function ToolsPage() {
  const catalog = await getFederatedTools();
  const groups = groupByCategory(catalog.tools);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Tools</h1>
        <p className="mt-2 max-w-2xl text-neutral-500 dark:text-neutral-400">
          Heavyweight platforms federated into Constellation. Each tile opens the tool through its
          SSO-proxied URL — the platform stays a single pane of glass without bundling foreign apps.
        </p>
        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
          {catalog.source === "none"
            ? "No modules.yaml configured — this surface is ready but empty. Drop a modules.yaml (or set NEXT_PUBLIC_FEDERATED_MODULES_URL) to populate it."
            : catalog.source === "remote"
              ? "Catalog sourced from NEXT_PUBLIC_FEDERATED_MODULES_URL."
              : "Catalog sourced from /modules.yaml."}
          {catalog.note ? ` ${catalog.note}` : ""}
        </p>
      </header>

      {catalog.tools.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <Boxes className="size-5" />
          </span>
          No federated tools are configured yet.
          <div className="mt-2 text-xs">
            Add entries to{" "}
            <code className="rounded bg-neutral-200 px-1 py-0.5 dark:bg-neutral-800">apps/web/public/modules.yaml</code>.
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {Array.from(groups.entries()).map(([category, tools]) => (
            <section key={category}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                {category}
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tools.map((tool) => (
                  <li key={tool.id}>
                    <FederatedToolTile tool={tool} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
