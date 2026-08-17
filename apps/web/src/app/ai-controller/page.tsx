"use client";

import { ControllerView } from "@/components/ai-controller/controller-view";

/**
 * `/ai-controller` — Phase 5.0: Agentic AI Controller. The platform's live
 * stability snapshot (score + findings + recommended actions) with one-click
 * whitelisted recovery actions. Admin-gated (core:audit:read — the API and
 * the nav entry both enforce it).
 */
export default function AiControllerPage() {
  return <ControllerView />;
}
