"use client";

import { CompareView } from "@/components/compare/compare-view";

/**
 * `/compare` — Phase 3.0 item 3.6: multi-model compare / A/B (same prompt on
 * 2+ models, side-by-side latency/tokens/cost/output).
 *
 * Client-rendered: engine task routes require a Bearer token that only exists
 * browser-side — same shape as `/engine`.
 */
export default function ComparePage() {
  return <CompareView />;
}
