import Link from "next/link";
import { ArrowLeft, ServerCrash } from "lucide-react";

import { getPluginDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PluginDetailView } from "@/components/modules/plugin-detail-view";

interface PageProps {
  params: Promise<{ pluginId: string; slug?: string[] }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function PluginMountPage({ params, searchParams }: PageProps) {
  const { pluginId } = await params;
  const { tab } = await searchParams;

  // OR2-1: render the FULL manifest. `getPluginDetail` degrades to `null` if the
  // core is unreachable, and the server component handles it as a 404 so the
  // not-found UI stays consistent (the client wrapper re-polls for live health).
  let plugin;
  try {
    plugin = await getPluginDetail(pluginId);
  } catch {
    plugin = null;
  }

  if (!plugin) {
    // Distinguish "not found" (unknown plugin id) from "core down". Both render
    // the friendly empty state, but the copy adjusts so the operator isn't misled.
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ServerCrash className="size-6" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">Module unavailable</h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          The core API didn&apos;t return <code className="rounded bg-neutral-200 px-1 py-0.5 font-mono text-xs dark:bg-neutral-800">{pluginId}</code>.
          The plugin may not be installed, or the core isn&apos;t running.
        </p>
        <Button asChild className="mt-6">
          <Link href="/modules">
            <ArrowLeft className="size-4" />
            Back to Modules
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-4xl items-center px-4 py-3 sm:px-6 lg:px-8">
          <Button asChild variant="ghost" size="sm">
            <Link href="/modules">
              <ArrowLeft className="size-4" />
              Modules
            </Link>
          </Button>
        </div>
      </div>
      <PluginDetailView plugin={plugin} defaultTab={tab === "tools" ? "tools" : undefined} />
    </>
  );
}
