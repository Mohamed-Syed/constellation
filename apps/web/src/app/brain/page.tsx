import type { Metadata } from "next";

import { BrainView } from "@/components/brain/brain-view";

export const metadata: Metadata = { title: "Brain" };

/**
 * `/brain` — the memory & knowledge-graph surface (docs/BRAIN.md §5/§6).
 *
 * Client-rendered: every `/api/brain/*` route requires a Bearer token, which
 * only exists browser-side (see `lib/auth-storage.ts`), so unlike `/admin` there
 * is no useful SSR prefetch to do here.
 */
export default function BrainPage() {
  return <BrainView />;
}
