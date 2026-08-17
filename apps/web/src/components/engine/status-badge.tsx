"use client";

import { Badge } from "@/components/ui/badge";
import { statusVariant } from "@/lib/engine";

/** Shared engine status badge (engine list + delegation tree). */
export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusVariant(status)}>{status}</Badge>;
}
