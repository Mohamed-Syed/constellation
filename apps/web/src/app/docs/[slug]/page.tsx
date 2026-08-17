import { notFound } from "next/navigation";
import { DocsShell } from "@/components/docs/docs-shell";
import { articleBySlug } from "@/content/docs/manifest";

/**
 * `/docs/[slug]` — one knowledge base article. Unknown slugs → 404.
 * The manifest lives in `src/content/docs/manifest.ts`.
 *
 * The route is deliberately dynamic: the app shell performs live fetches
 * (revalidate: 0), which Next.js 15 refuses to mix with a statically
 * prerendered page (app-static-to-dynamic error).
 */
export const dynamic = "force-dynamic";

export default async function DocArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = articleBySlug(slug);
  if (!article) notFound();
  return <DocsShell activeSlug={slug} />;
}
