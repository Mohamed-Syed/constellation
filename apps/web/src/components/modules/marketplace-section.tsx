"use client";

import * as React from "react";
import { Boxes, Loader2, PackagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getPluginCatalog,
  installCatalogPlugin,
  uninstallCatalogPlugin,
  type CatalogAvailablePlugin,
  type PluginCatalog,
} from "@/lib/api";

/**
 * Phase 3.0 — PLUGIN MARKETPLACE section (on /modules).
 *
 * Two zones: "Installed from the marketplace" (catalog-installed plugins get
 * an Uninstall button — hand-placed plugins are NEVER offered here) and
 * "Available in the catalog" (bundled plugins-catalog entries with an Install
 * button). Mutations hit the guarded install/uninstall routes; the installed
 * grid above picks up the change on its own 5s live poll.
 */
export function MarketplaceSection() {
  const { token } = useAuth();
  const [catalog, setCatalog] = React.useState<PluginCatalog | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const data = await getPluginCatalog(token ?? undefined);
    if (!data) return;
    setCatalog(data);
  }, [token]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleInstall = async (plugin: CatalogAvailablePlugin) => {
    if (!token || busyId) return;
    setBusyId(plugin.id);
    const res = await installCatalogPlugin(plugin.id, token);
    if (res.ok) {
      toast.success(`${plugin.name} installed`, { description: "The registry reloaded — it is now live." });
      await refresh();
    } else {
      toast.error("Install failed", { description: res.message });
    }
    setBusyId(null);
  };

  const handleUninstall = async (id: string, name: string) => {
    if (!token || busyId) return;
    setBusyId(id);
    const res = await uninstallCatalogPlugin(id, token);
    if (res.ok) {
      toast.info(`${name} uninstalled`, { description: "The plugin folder was removed." });
      await refresh();
    } else {
      toast.error("Uninstall failed", { description: res.message });
    }
    setBusyId(null);
  };

  // Catalog-installed plugins come from the INSTALLED list (they leave
  // `available` once installed — cross-referencing would find nothing).
  const installedFromCatalog = (catalog?.installed ?? []).filter((p) => p.catalogInstalled);

  return (
    <section className="mt-10">
      <header className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Boxes className="size-5 text-accent" />
          Plugin marketplace
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
          Bundled plugins ship in <code className="rounded bg-neutral-200 px-1 py-0.5 text-xs dark:bg-neutral-800">plugins-catalog/</code>{" "}
          and install here without a restart. Installed plugins appear in the grid above.
        </p>
      </header>

      {catalog === null ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          Marketplace unavailable — the core API isn&apos;t responding.
        </p>
      ) : catalog.available.length === 0 && installedFromCatalog.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          The catalog is empty — drop a plugin folder into{" "}
          <code className="rounded bg-neutral-200 px-1 py-0.5 dark:bg-neutral-800">plugins-catalog/</code>{" "}
          and it appears here.
        </div>
      ) : (
        <div className="space-y-6">
          {installedFromCatalog.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                Installed from the marketplace
              </p>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {installedFromCatalog.map((p) => (
                  <li key={p.id}>
                    <Card className="h-full">
                      <CardHeader className="flex-row items-start justify-between space-y-0">
                        <CardTitle className="truncate text-base">{p.name}</CardTitle>
                        <Badge variant="success">installed</Badge>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <CardDescription className="line-clamp-2">{p.description}</CardDescription>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => void handleUninstall(p.id, p.name)}
                          disabled={busyId === p.id || !token}
                        >
                          {busyId === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                          Uninstall
                        </Button>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {catalog.available.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                Available in the catalog
              </p>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {catalog.available.map((p) => (
                  <li key={p.id}>
                    <Card className="h-full">
                      <CardHeader className="flex-row items-start justify-between space-y-0">
                        <CardTitle className="truncate text-base">{p.name}</CardTitle>
                        <Badge variant="neutral">v{p.version}</Badge>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <CardDescription className="line-clamp-2">{p.description}</CardDescription>
                        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                          {p.permissions.length} permission{p.permissions.length === 1 ? "" : "s"} · {p.toolCount} tool{p.toolCount === 1 ? "" : "s"}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          className="mt-3"
                          onClick={() => void handleInstall(p)}
                          disabled={busyId === p.id || !token}
                        >
                          {busyId === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <PackagePlus className="size-3.5" />}
                          Install
                        </Button>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
