"use client";

import { DocsShell } from "@/components/docs/docs-shell";

/**
 * `/docs` — the in-app Knowledge base home (section cards + search). The
 * whole knowledge base is rendered from `src/content/docs/manifest.ts`.
 */
export default function DocsPage() {
  return <DocsShell activeSlug={null} />;
}
