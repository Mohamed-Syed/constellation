import * as React from "react";
import { ExternalLink, Lock } from "lucide-react";

import type { FederatedTool, FederatedToolStatus } from "@/lib/federated-tools";
import { cn } from "@/lib/utils";
import { resolveIcon } from "@/lib/icons";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_LABEL: Record<FederatedToolStatus, string> = {
  live: "Live",
  provisioning: "Provisioning",
  planned: "Planned",
  unknown: "Unknown",
};

const STATUS_VARIANT: Record<FederatedToolStatus, NonNullable<BadgeProps["variant"]>> = {
  live: "success",
  provisioning: "warning",
  planned: "info",
  unknown: "neutral",
};

export function federatedStatusLabel(status: FederatedToolStatus): string {
  return STATUS_LABEL[status];
}
export function federatedStatusVariant(status: FederatedToolStatus): NonNullable<BadgeProps["variant"]> {
  return STATUS_VARIANT[status];
}

/**
 * Federated tool tile (P3 portal federation). Renders one heavyweight external
 * tool (Grafana/Langflow/Open WebUI/Coolify/…) as a card. When `url` is present
 * and the tool is openable, the whole tile is a link that opens the tool (SSO
 * proxy target) in a new tab; otherwise it renders as a non-interactive
 * placeholder card so the catalog still communicates "this is coming".
 */
export function FederatedToolTile({ tool }: { tool: FederatedTool }) {
  const Icon = resolveIcon(tool.icon);
  const interactive = tool.openable && Boolean(tool.url);

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
              <CardDescription className="truncate">{tool.category}</CardDescription>
            ) : null}
          </div>
        </div>
        <Badge variant={federatedStatusVariant(tool.status)}>{federatedStatusLabel(tool.status)}</Badge>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="mb-3 line-clamp-2 min-h-[2.5rem] text-sm text-neutral-500 dark:text-neutral-400">
          {tool.description || "No description provided."}
        </p>
        <div className="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
          {interactive ? (
            <>
              <ExternalLink className="size-3.5" />
              <span className="truncate">Open {tool.name}</span>
            </>
          ) : (
            <>
              <Lock className="size-3.5" />
              <span>
                {tool.url ? "Not ready yet" : "No URL configured"}
              </span>
            </>
          )}
        </div>
      </CardContent>
    </>
  );

  if (interactive) {
    return (
      <a
        href={tool.url}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(
          "group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950",
        )}
      >
        <Card className="h-full transition hover:shadow-md">{inner}</Card>
      </a>
    );
  }

  return (
    <Card className="h-full opacity-90" aria-disabled="true">
      {inner}
    </Card>
  );
}
