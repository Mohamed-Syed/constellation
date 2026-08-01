type PluginSummary = {
  id: string;
  name: string;
  version: string;
  description: string;
  state: string;
  error?: string;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

async function getPlugins(): Promise<PluginSummary[]> {
  try {
    const res = await fetch(`${API}/plugins`, { cache: "no-store" });
    if (!res.ok) return [];
    return (await res.json()) as PluginSummary[];
  } catch {
    return [];
  }
}

const stateColor: Record<string, string> = {
  enabled: "bg-emerald-500/15 text-emerald-500",
  registered: "bg-sky-500/15 text-sky-500",
  validated: "bg-sky-500/15 text-sky-500",
  failed: "bg-rose-500/15 text-rose-500",
};

export default async function Home() {
  const plugins = await getPlugins();

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="mb-12">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Constellation Platform · v0.1.0
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Modules</h1>
        <p className="mt-2 max-w-2xl text-neutral-500">
          Every installed plugin appears here automatically. Drop a repository into{" "}
          <code className="rounded bg-neutral-200 px-1 py-0.5 text-sm dark:bg-neutral-800">
            /plugins
          </code>{" "}
          with a valid manifest and the core discovers it — no code changes.
        </p>
      </header>

      {plugins.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-neutral-500 dark:border-neutral-700">
          No modules loaded yet, or the core API isn&apos;t running.
          <div className="mt-2 text-sm">
            Start it with <code>pnpm --filter @constellation/api dev</code> on port 4000.
          </div>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {plugins.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border border-neutral-200 bg-white p-5 transition hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{p.name}</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    stateColor[p.state] ?? "bg-neutral-500/15 text-neutral-500"
                  }`}
                >
                  {p.state}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-500">{p.description || "—"}</p>
              <div className="mt-3 text-xs text-neutral-400">
                {p.id} · v{p.version}
              </div>
              {p.error ? <p className="mt-2 text-xs text-rose-500">{p.error}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
