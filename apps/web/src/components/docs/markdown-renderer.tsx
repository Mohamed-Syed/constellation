"use client";

import * as React from "react";

/**
 * Minimal, escape-first markdown renderer for the Knowledge base.
 * Supports the subset the articles use: headings, paragraphs, **bold**,
 * `inline code`, [links](url), *italic*, unordered/ordered lists, fenced code
 * blocks, GFM-style tables, blockquote callouts, and horizontal rules.
 * All text is HTML-escaped before rendering (the content is trusted, but the
 * renderer never emits raw HTML).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type InlineNode = { type: "text"; text: string } | { type: "code"; text: string } | { type: "strong"; children: InlineNode[] } | { type: "em"; children: InlineNode[] } | { type: "link"; href: string; children: InlineNode[] };

/** Tokenize inline markdown (bold, code, italic, links) into a node tree. */
function tokenizeInline(src: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let rest = src;
  while (rest.length > 0) {
    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      nodes.push({ type: "code", text: code[1]! });
      rest = rest.slice(code[0]!.length);
      continue;
    }
    const link = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (link) {
      nodes.push({ type: "link", href: link[2]!, children: tokenizeInline(link[1]!) });
      rest = rest.slice(link[0]!.length);
      continue;
    }
    const strong = rest.match(/^\*\*([^*]+)\*\*/);
    if (strong) {
      nodes.push({ type: "strong", children: tokenizeInline(strong[1]!) });
      rest = rest.slice(strong[0]!.length);
      continue;
    }
    const em = rest.match(/^\*([^*]+)\*/);
    if (em) {
      nodes.push({ type: "em", children: tokenizeInline(em[1]!) });
      rest = rest.slice(em[0]!.length);
      continue;
    }
    // Plain run until the next special char.
    const next = rest.search(/[`*[]/);
    if (next === 0) {
      // A lone special char we can't parse — treat it literally.
      nodes.push({ type: "text", text: rest[0]! });
      rest = rest.slice(1);
    } else if (next === -1) {
      nodes.push({ type: "text", text: rest });
      rest = "";
    } else {
      nodes.push({ type: "text", text: rest.slice(0, next) });
      rest = rest.slice(next);
    }
  }
  return nodes;
}

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <React.Fragment>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "text":
            return <React.Fragment key={i}>{escapeHtml(n.text)}</React.Fragment>;
          case "code":
            return (
              <code key={i} className="rounded bg-base-200 px-1.5 py-0.5 font-mono text-[0.85em] text-accent">
                {escapeHtml(n.text)}
              </code>
            );
          case "strong":
            return <strong key={i}>{<Inline nodes={n.children} />}</strong>;
          case "em":
            return <em key={i}>{<Inline nodes={n.children} />}</em>;
          case "link":
            return (
              <a key={i} href={escapeHtml(n.href)} className="text-accent underline underline-offset-2 hover:opacity-80">
                {<Inline nodes={n.children} />}
              </a>
            );
        }
      })}
    </React.Fragment>
  );
}

function inlineText(text: string) {
  return <Inline nodes={tokenizeInline(text)} />;
}

/** Callout tone for `> **NOTE:**` / `> **TIP:**` / `> **IMPORTANT:**` blockquotes. */
function calloutTone(firstLine: string): { tone: "note" | "tip" | "important" | "plain"; label: string | null } {
  const m = firstLine.match(/^>\s*\*\*(NOTE|TIP|IMPORTANT)\*\*:?\s*(.*)$/i);
  if (!m) return { tone: "plain", label: null };
  const label = m[1]!.toUpperCase();
  const tone = label === "TIP" ? "tip" : label === "IMPORTANT" ? "important" : "note";
  return { tone, label };
}

function Callout({ firstLine, restLines }: { firstLine: string; restLines: string[] }) {
  const { tone, label } = calloutTone(firstLine);
  // Body = the first line with the "> " prefix and the "**LABEL:**" prefix
  // stripped, plus any continuation lines.
  const body = firstLine
    .replace(/^>\s?/, "")
    .replace(/^\*\*(NOTE|TIP|IMPORTANT)\*\*:?\s*/i, "")
    .concat(restLines.length ? " " + restLines.map((l) => l.replace(/^>\s?/, "")).join(" ") : "");
  const toneClass =
    tone === "tip"
      ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200"
      : tone === "important"
        ? "border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-200"
        : tone === "note"
          ? "border-sky-500/40 bg-sky-500/5 text-sky-800 dark:text-sky-200"
          : "border-base-300 bg-base-200/40 text-base-content/80";
  const labelText = label ?? (tone === "plain" ? "" : tone === "tip" ? "TIP" : tone === "important" ? "IMPORTANT" : "NOTE");
  return (
    <blockquote className={`my-4 rounded-r-xl border-l-2 px-4 py-3 text-sm ${toneClass}`}>
      {labelText ? <span className="mb-1 block font-semibold uppercase tracking-wider text-xs">{labelText}</span> : null}
      <div className="text-[0.95em]">{inlineText(body)}</div>
    </blockquote>
  );
}

/** Split the raw markdown into block tokens. */
interface Block {
  kind: "heading2" | "heading3" | "paragraph" | "list" | "code" | "table" | "callout" | "hr";
  text?: string;
  items?: string[];
  ordered?: boolean;
  lang?: string;
  rows?: string[][];
  firstLine?: string;
  restLines?: string[];
}

function parseBlocks(md: string): Block[] {
  const lines = md.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  // Drop the leading `# Title` (the page header renders it) and its
  // description line if present.
  while (i < lines.length && lines[i]!.trim() === "") i++;

  for (; i < lines.length; ) {
    const line = lines[i]!;

    if (line.trim() === "") {
      i++;
      continue;
    }
    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, "").trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        buf.push(lines[i]!);
        i++;
      }
      i++; // closing fence
      blocks.push({ kind: "code", lang, text: buf.join("\n") });
      continue;
    }
    // Heading
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      blocks.push({ kind: "heading2", text: h2[1]! });
      i++;
      continue;
    }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      blocks.push({ kind: "heading3", text: h3[1]! });
      i++;
      continue;
    }
    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    // Blockquote callout (consume consecutive > lines)
    if (/^>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>/.test(lines[i]!)) {
        buf.push(lines[i]!);
        i++;
      }
      blocks.push({ kind: "callout", firstLine: buf[0], restLines: buf.slice(1) });
      continue;
    }
    // Table: current line starts with | and the NEXT line is a separator row
    if (line.startsWith("|") && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1]!) && lines[i + 1]!.includes("-")) {
      const rows: string[][] = [];
      const parseRow = (l: string) =>
        l
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      rows.push(parseRow(line));
      i += 2; // skip header + separator
      while (i < lines.length && lines[i]!.startsWith("|")) {
        rows.push(parseRow(lines[i]!));
        i++;
      }
      blocks.push({ kind: "table", rows });
      continue;
    }
    // List (consecutive - or 1. lines)
    const ul = line.match(/^\s*-\s+(.+)$/);
    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ul || ol) {
      const items: string[] = [];
      const ordered = Boolean(ol);
      const re = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*-\s+(.+)$/;
      while (i < lines.length && re.test(lines[i]!)) {
        const m = lines[i]!.match(re)!;
        items.push(m[1]!);
        i++;
      }
      blocks.push({ kind: "list", items, ordered });
      continue;
    }
    // Paragraph: consume until a blank line or a block start.
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^```/.test(lines[i]!) &&
      !/^#{1,3}\s/.test(lines[i]!) &&
      !/^>/.test(lines[i]!) &&
      !/^\s*-\s+/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!) &&
      !/^---+\s*$/.test(lines[i]!)
    ) {
      buf.push(lines[i]!);
      i++;
    }
    blocks.push({ kind: "paragraph", text: buf.join(" ") });
  }
  return blocks;
}

export function Markdown({ body }: { body: string }) {
  const blocks = React.useMemo(() => parseBlocks(body), [body]);
  return (
    <div className="docs-prose flex flex-col gap-4 text-[0.95rem] leading-relaxed text-base-content/90">
      {blocks.map((b, idx) => {
        switch (b.kind) {
          case "heading2":
            return (
              <h2 key={idx} className="mt-4 scroll-mt-24 text-xl font-semibold tracking-tight">
                {inlineText(b.text ?? "")}
              </h2>
            );
          case "heading3":
            return (
              <h3 key={idx} className="mt-3 scroll-mt-24 text-base font-semibold tracking-tight">
                {inlineText(b.text ?? "")}
              </h3>
            );
          case "paragraph":
            return <p key={idx}>{inlineText(b.text ?? "")}</p>;
          case "list":
            return b.ordered ? (
              <ol key={idx} className="flex list-decimal flex-col gap-1.5 pl-6 marker:text-base-content/50">
                {b.items!.map((it, j) => (
                  <li key={j}>{inlineText(it)}</li>
                ))}
              </ol>
            ) : (
              <ul key={idx} className="flex list-disc flex-col gap-1.5 pl-6 marker:text-base-content/50">
                {b.items!.map((it, j) => (
                  <li key={j}>{inlineText(it)}</li>
                ))}
              </ul>
            );
          case "code":
            return (
              <pre key={idx} className="overflow-x-auto rounded-xl border border-base-300 bg-base-200/60 p-4 text-[0.82rem] leading-relaxed">
                <code className="font-mono">{escapeHtml(b.text ?? "")}</code>
              </pre>
            );
          case "table":
            return (
              <div key={idx} className="overflow-x-auto rounded-xl border border-base-300">
                <table className="w-full text-left text-[0.9rem]">
                  <thead>
                    <tr className="border-b border-base-300 bg-base-200/50">
                      {b.rows![0]!.map((h, j) => (
                        <th key={j} className="px-4 py-2.5 font-semibold">
                          {inlineText(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows!.slice(1).map((row, j) => (
                      <tr key={j} className="border-b border-base-300/60 last:border-0">
                        {row.map((c, k) => (
                          <td key={k} className="px-4 py-2.5 align-top">
                            {inlineText(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "callout":
            return <Callout key={idx} firstLine={b.firstLine ?? ""} restLines={b.restLines ?? []} />;
          case "hr":
            return <hr key={idx} className="border-base-300" />;
        }
      })}
    </div>
  );
}
