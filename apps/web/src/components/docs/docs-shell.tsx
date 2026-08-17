"use client";

import * as React from "react";
import { BookOpen, ChevronRight, Home, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Reveal } from "@/components/motion/reveal";
import {
  DOC_ARTICLE_COUNT,
  DOC_SECTIONS,
  articlesInSection,
  sectionById,
  type DocArticle,
} from "@/content/docs/manifest";
import { Markdown } from "./markdown-renderer";

/**
 * The in-app Knowledge base shell (Microsoft-Learn-style): left TOC grouped
 * by section, live client-side search over titles/descriptions/body, the
 * article view, and prev/next paging.
 */

function SearchBox({ query, onChange }: { query: string; onChange: (q: string) => void }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search the knowledge base…"
        className="w-full rounded-xl border border-base-300 bg-base-100 py-2.5 pl-9 pr-3 text-sm outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
    </div>
  );
}

function Sidebar({ activeSlug, query, onNavigate }: { activeSlug: string | null; query: string; onNavigate: () => void }) {
  return (
    <nav className="flex w-full flex-col gap-5 lg:w-60 lg:shrink-0">
      {DOC_SECTIONS.map((section) => {
        const articles = articlesInSection(section.id);
        return (
          <div key={section.id}>
            <p className="mb-1.5 px-2 text-[0.68rem] font-semibold uppercase tracking-widest text-muted-foreground">
              {section.label}
            </p>
            <ul className="flex flex-col">
              {articles.map((a) => {
                const active = activeSlug === a.slug;
                return (
                  <li key={a.slug}>
                    <Link
                      href={`/docs/${a.slug}`}
                      onClick={onNavigate}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all ${
                        active
                          ? "bg-accent/10 font-medium text-accent"
                          : "text-base-content/75 hover:bg-base-200/60 hover:text-base-content"
                      }`}
                    >
                      {active ? <ChevronRight className="size-3.5 shrink-0" /> : <span className="size-3.5 shrink-0" />}
                      {a.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {query.trim() !== "" ? (
        <p className="px-2 text-xs text-muted-foreground">
          Filtering {DOC_ARTICLE_COUNT} articles by “{query.trim()}”
        </p>
      ) : null}
    </nav>
  );
}

function ArticleView({ article, onNavigate }: { article: DocArticle; onNavigate: () => void }) {
  const all = DOC_SECTIONS.flatMap((s) => articlesInSection(s.id));
  const idx = all.findIndex((a) => a.slug === article.slug);
  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;
  const section = sectionById(article.section);

  return (
    <article className="min-w-0 flex-1">
      {/* Breadcrumb */}
      <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/docs" className="inline-flex items-center gap-1 transition-colors hover:text-accent">
          <Home className="size-3" /> Knowledge base
        </Link>
        <ChevronRight className="size-3" />
        <span>{section?.label ?? article.section}</span>
        <ChevronRight className="size-3" />
        <span className="text-base-content/80">{article.title}</span>
      </nav>

      <header className="mb-6">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
          <BookOpen className="size-3.5" />
          {section?.label ?? "Knowledge base"}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{article.title}</h1>
        {article.description ? <p className="mt-2 text-sm text-muted-foreground">{article.description}</p> : null}
      </header>

      <Markdown body={article.body} />

      {/* Prev / next */}
      <div className="mt-10 grid gap-3 border-t border-base-300 pt-6 sm:grid-cols-2">
        {prev ? (
          <Link
            href={`/docs/${prev.slug}`}
            onClick={onNavigate}
            className="group flex flex-col gap-1 rounded-xl border border-base-300 p-4 transition-all hover:border-accent/50 hover:bg-base-200/40"
          >
            <span className="text-xs text-muted-foreground">← Previous</span>
            <span className="text-sm font-medium group-hover:text-accent">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/docs/${next.slug}`}
            onClick={onNavigate}
            className="group flex flex-col items-end gap-1 rounded-xl border border-base-300 p-4 text-right transition-all hover:border-accent/50 hover:bg-base-200/40"
          >
            <span className="text-xs text-muted-foreground">Next →</span>
            <span className="text-sm font-medium group-hover:text-accent">{next.title}</span>
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function DocsShell({ activeSlug }: { activeSlug: string | null }) {
  const pathname = usePathname();
  const [query, setQuery] = React.useState("");
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const q = query.trim().toLowerCase();
  const matching: DocArticle[] = React.useMemo(() => {
    if (!q) return [];
    return DOC_SECTIONS.flatMap((s) => articlesInSection(s.id))
      .filter((a) => {
        const hay = `${a.title} ${a.description} ${sectionById(a.section)?.label ?? ""} ${a.body}`.toLowerCase();
        return q.split(/\s+/).every((word) => hay.includes(word));
      })
      .slice(0, 25);
  }, [q]);

  const activeArticle = activeSlug ? DOC_SECTIONS.flatMap((s) => articlesInSection(s.id)).find((a) => a.slug === activeSlug) : undefined;

  // Close the mobile sidebar on navigation.
  const closeSidebar = React.useCallback(() => setSidebarOpen(false), []);

  // Reset search when the article changes.
  React.useEffect(() => {
    setQuery("");
  }, [pathname]);

  return (
    <Reveal className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
            <BookOpen className="size-3.5" />
            In-app documentation
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge base</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Everything about using Constellation, end to end — {DOC_ARTICLE_COUNT} articles across{" "}
            {DOC_SECTIONS.length} sections. Searchable, always in the application.
          </p>
        </div>
        <div className="w-full sm:w-80">
          <SearchBox query={query} onChange={setQuery} />
        </div>
      </div>

      {/* Mobile sidebar toggle */}
      <button
        type="button"
        onClick={() => setSidebarOpen((o) => !o)}
        className="self-start rounded-lg border border-base-300 px-3 py-1.5 text-sm lg:hidden"
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? "Hide contents" : "Show contents"}
      </button>

      <div className="flex flex-col gap-8 lg:flex-row">
        <div className={sidebarOpen ? "block" : "hidden lg:block"}>
          <Sidebar activeSlug={activeSlug} query={query} onNavigate={closeSidebar} />
        </div>

        {q ? (
          /* Search results */
          <div className="min-w-0 flex-1">
            <h2 className="mb-3 text-base font-semibold">
              {matching.length} result{matching.length === 1 ? "" : "s"} for “{query.trim()}”
            </h2>
            {matching.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-base-300 py-12 text-muted-foreground">
                <SearchX className="size-6" />
                <p className="text-sm">No articles match “{query.trim()}”. Try a broader term.</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {matching.map((a) => {
                  const section = sectionById(a.section);
                  return (
                    <li key={a.slug}>
                      <Link
                        href={`/docs/${a.slug}`}
                        onClick={closeSidebar}
                        className="block rounded-xl border border-base-300 p-4 transition-all hover:border-accent/50 hover:bg-base-200/40"
                      >
                        <p className="text-[0.68rem] font-semibold uppercase tracking-widest text-muted-foreground">
                          {section?.label}
                        </p>
                        <p className="mt-1 text-sm font-medium">{a.title}</p>
                        {a.description ? <p className="mt-1 text-xs text-muted-foreground">{a.description}</p> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : activeArticle ? (
          <ArticleView article={activeArticle} onNavigate={closeSidebar} />
        ) : (
          /* KB home — section cards */
          <div className="min-w-0 flex-1">
            <div className="grid gap-3 sm:grid-cols-2">
              {DOC_SECTIONS.map((section) => {
                const articles = articlesInSection(section.id);
                return (
                  <div key={section.id} className="rounded-xl border border-base-300 bg-base-100 p-4 transition-all hover:border-accent/50">
                    <p className="text-sm font-semibold">{section.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {articles.length} article{articles.length === 1 ? "" : "s"}
                    </p>
                    <ul className="mt-3 flex flex-col gap-1">
                      {articles.map((a) => (
                        <li key={a.slug}>
                          <Link
                            href={`/docs/${a.slug}`}
                            onClick={closeSidebar}
                            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-base-content/75 transition-colors hover:bg-base-200/60 hover:text-accent"
                          >
                            <ChevronRight className="size-3 text-muted-foreground" />
                            {a.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Reveal>
  );
}
