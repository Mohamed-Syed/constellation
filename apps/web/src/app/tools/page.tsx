"use client";

import * as React from "react";
import { Boxes, ServerCrash } from "lucide-react";

import { fetchFederatedModules, type FederatedTool } from "@/lib/federated";
import { useAuth } from "@/components/auth/auth-provider";
import { FederatedToolTile } from "@/components/modules/federated-tool-tile";

export default function ToolsPage() {
  const { token } = useAuth();
  return <FederatedToolsView token={token} />;
}

function FederatedToolsView({ token }: { token: string | null }) {
  const [tools, setTools] = React.useState<FederatedTool[] | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      const result = await fetchFederatedModules(token);
      if (!active) return;
      // fetchFederatedModules degrades to [] on any failure; treat null-never, but
      // flag an error only if we got nothing AND we had a token (likely API down).
      setTools(result);
      setError(result.length === 0 && Boolean(token));
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const groups = React.useMemo(() => {
    const map = new Map<string, FederatedTool[]>();
    for (const t of tools ?? []) {
      const key = t.category || "General";
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [tools]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Tools</h1>
        <p className="mt-2 max-w-2xl text-neutral-500 dark:text-neutral-400">
          Heavyweight platforms federated into Constellation. Each tile opens the tool through its
          SSO-proxied path — the platform stays a single pane of glass without bundling foreign apps.
        </p>
      </header>

      {tools === null ? (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          Loading federated tools…
        </div>
      ) : tools.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <Boxes className="size-5" />
          </span>
          {error ? (
            <>
              <ServerCrash className="mx-auto mb-2 size-5" />
              Couldn&apos;t reach the federation registry. The platform may be starting up.
            </>
          ) : (
            <>
              No federated tools are configured yet.
              <div className="mt-2 text-xs">
                Add entries to{" "}
                <code className="rounded bg-neutral-200 px-1 py-0.5 dark:bg-neutral-800">config/modules.yaml</code> on
                the API.
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                {category}
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((tool) => (
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
