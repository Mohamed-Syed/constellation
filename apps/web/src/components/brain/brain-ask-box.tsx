"use client";

import * as React from "react";
import { AlertTriangle, BrainCircuit, FileText, Search, Send } from "lucide-react";

import { askBrain, nodeKind, refLabel, refNodeId, type BrainAnswer, type BrainGraphRef } from "@/lib/brain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * "Ask the brain" (BRAIN.md §6).
 *
 * POSTs to `/api/brain/query` and renders the grounded answer TOGETHER WITH its
 * provenance. Provenance is not an afterthought here: an answer with no sources
 * is explicitly flagged as ungrounded rather than presented as fact — that's the
 * "honest-abstain" discipline in BRAIN.md §4, and the whole reason for having a
 * graph rather than a chat box.
 *
 * Hovering/clicking a provenance chip highlights the corresponding node in the
 * graph view above (via `onProvenanceChange`), so a claim is traceable to
 * structure, not just to a filename.
 */
export function BrainAskBox({
  token,
  canRead,
  caveat,
  onProvenanceChange,
}: {
  token: string | null;
  /** Whether the caller holds `core:brain:read`. False ⇒ the form is inert. */
  canRead: boolean;
  /**
   * A caveat to show above the box (e.g. "the graph isn't built"). NOTE: this
   * does NOT disable asking. Verified live 2026-08-02: with no graph the API
   * still answers from a literal text match over the `brain/` vault and flags
   * the result `grounded: false`. That's genuinely useful, and the ungrounded
   * badge already tells the truth about it — so we surface the caveat and let
   * the user ask anyway rather than blocking a working endpoint.
   */
  caveat?: string | null;
  onProvenanceChange?: (nodeIds: string[]) => void;
}) {
  const [question, setQuestion] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [answer, setAnswer] = React.useState<BrainAnswer | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const disabled = !canRead || pending;

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    const q = question.trim();
    if (!q || disabled) return;
    setPending(true);
    setError(null);
    setAnswer(null);
    onProvenanceChange?.([]);

    const result = await askBrain(q, token);
    setPending(false);

    if (result.state === "ok") {
      setAnswer(result.data);
      onProvenanceChange?.(
        result.data.provenance.map(refNodeId).filter((id): id is string => typeof id === "string"),
      );
    } else {
      setError(result.message);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <BrainCircuit className="size-4" />
        </span>
        <div>
          <CardTitle className="text-base">Ask the brain</CardTitle>
          <CardDescription>
            A grounded answer from the knowledge graph — always shown with the sources it came from.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <form onSubmit={handleAsk} className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={disabled}
              aria-label="Question for the brain"
              placeholder="What connects the plugin loader to the SDK?"
              className="h-10 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-sm shadow-sm transition-colors placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900"
            />
          </div>
          <Button type="submit" disabled={disabled || question.trim().length === 0} aria-busy={pending}>
            {pending ? null : <Send className="size-4" />}
            {pending ? "Thinking…" : "Ask"}
          </Button>
        </form>

        {!canRead ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Requires the <code className="font-mono">core:brain:read</code> permission.
          </p>
        ) : caveat ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{caveat}</p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        ) : null}

        {answer ? <AnswerPanel answer={answer} /> : null}
      </CardContent>
    </Card>
  );
}

function AnswerPanel({ answer }: { answer: BrainAnswer }) {
  // `grounded` is the API's own honesty flag (MemoryAnswer.grounded) — trust it
  // over the ref count. An answer can carry refs and still be flagged
  // ungrounded, and that distinction is exactly what we must not paper over.
  const grounded = answer.grounded;
  return (
    <div role="status" className="space-y-3">
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
        <p className="whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-100">
          {answer.answer || "The brain returned no answer for that question."}
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            Provenance
          </h3>
          {grounded ? (
            <Badge variant="success">
              grounded · {answer.provenance.length} source{answer.provenance.length === 1 ? "" : "s"}
            </Badge>
          ) : (
            <Badge variant="warning" className="gap-1">
              <AlertTriangle className="size-3" /> ungrounded
            </Badge>
          )}
        </div>

        {!grounded ? (
          <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
            The brain could not ground this answer (no graph built, the engine is absent, or nothing
            relevant was found). Treat it as unverified.
          </p>
        ) : null}

        {answer.provenance.length > 0 ? (
          <ul className="space-y-2">
            {answer.provenance.map((ref, i) => (
              <ProvenanceRow key={`${refNodeId(ref) ?? "ref"}-${i}`} refItem={ref} />
            ))}
          </ul>
        ) : grounded ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            The engine reported this answer as grounded but returned no source nodes.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ProvenanceRow({ refItem }: { refItem: BrainGraphRef }) {
  const source = refItem.path ?? refItem.file ?? null;
  const nodeId = refNodeId(refItem);
  return (
    <li className="rounded-lg border border-neutral-200 p-2.5 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="size-3.5 shrink-0 text-neutral-400" />
        <span className="font-medium text-neutral-800 dark:text-neutral-100">{refLabel(refItem)}</span>
        {nodeKind(refItem) ? (
          <Badge variant="info" className="text-[10px]">
            {nodeKind(refItem)}
          </Badge>
        ) : null}
        {typeof refItem.score === "number" ? (
          <Badge variant="neutral" className="text-[10px]">
            score {refItem.score.toFixed(2)}
          </Badge>
        ) : null}
      </div>
      {source && source !== refLabel(refItem) ? (
        <div className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{source}</div>
      ) : null}
      {nodeId && nodeId !== refLabel(refItem) ? (
        <div className="mt-0.5 break-all font-mono text-[11px] text-neutral-400 dark:text-neutral-500">
          node: {nodeId}
        </div>
      ) : null}
      {refItem.snippet ? (
        <blockquote className="mt-1.5 border-l-2 border-neutral-300 pl-2 text-xs italic text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
          {refItem.snippet}
        </blockquote>
      ) : null}
    </li>
  );
}
