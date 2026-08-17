import * as React from "react";
import { ExternalLink, Lock, ShieldCheck } from "lucide-react";

import type { FederatedTool } from "@/lib/federated";
import { canOpenModule } from "@/lib/federated";
import { useAuth } from "@/components/auth/auth-provider";
import { cn } from "@/lib/utils";
import { resolveIcon } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const CATEGORY_LABEL: Record<string, string> = {};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? (category ? category.charAt(0).toUpperCase() + category.slice(1) : "General");
}

/**
 * Federated tool tile (P3 portal federation). Renders one heavyweight external
 * tool (Grafana/Langflow/Open WebUI/Coolify/…) as a card. The whole tile links
 * to the tool's proxied `path` (behind the platform's SSO session). When the
 * caller lacks the module's `requiresPermissions`, the tile is shown but marked
 * locked (the reverse proxy enforces the real boundary server-side). Degrades
 * gracefully — a module with no `path` renders as a non-interactive card.
 */
export function FederatedToolTile({ tool }: { tool: FederatedTool }) {
  const { permissions } = useAuth();
  const Icon = resolveIcon(tool.icon);
  const allowed = canOpenModule(tool.requiresPermissions, permissions ?? []);

  const inner = (
    <>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{tool.name}</CardTitle>
            {tool.category ? (
              <CardDescription className="truncate">{categoryLabel(tool.category)}</CardDescription>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {tool.sso ? <Badge variant="accent">SSO</Badge> : null}
          {tool.embeddable ? <Badge variant="info">Embeddable</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="mb-3 line-clamp-2 min-h-[2.5rem] text-sm text-neutral-500 dark:text-neutral-400">
          {tool.description || "No description provided."}
        </p>
        <div className="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
          {tool.path ? (
            <>
              <ExternalLink className="size-3.5" />
              <span className="truncate">{tool.path}</span>
            </>
          ) : (
            <span>No proxied path configured</span>
          )}
        </div>
        {tool.requiresPermissions.length > 0 ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
            <ShieldCheck className="size-3.5" />
            <span className="truncate font-mono">{tool.requiresPermissions.join(", ")}</span>
          </p>
        ) : null}
      </CardContent>
    </>
  );

  if (tool.path && allowed) {
    return (
      <a
        href={tool.path}
        target="_blank"
        rel="noreferrer noopener"
        className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <Card className="surface-hover h-full">{inner}</Card>
      </a>
    );
  }

  return (
    <Card className={cn("h-full", !allowed && "opacity-80")} aria-disabled="true">
      {inner}
      {!allowed ? (
        <div className="flex items-center gap-1.5 border-t border-neutral-200 px-5 py-2 text-xs text-amber-600 dark:border-neutral-800 dark:text-amber-400">
          <Lock className="size-3.5" />
          Requires additional permissions.
        </div>
      ) : null}
    </Card>
  );
}
