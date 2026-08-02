"use client";

import { EngineView } from "@/components/engine/engine-view";

/**
 * `/engine` — the agentic task runtime surface (HANDOFF §8 item 1b, Orion lane).
 *
 * Client-rendered: every `/api/engine/*` route except health requires a Bearer
 * token that only exists browser-side (`lib/auth-storage.ts`), so there is no
 * useful SSR prefetch to do — same shape as `/tools`.
 */
export default function EnginePage() {
  return <EngineView />;
}
