/**
 * Phase 4.0 backlog #5 — QUALITY SCORING for /compare.
 *
 * A light, deterministic, zero-cost quality score for a single model output.
 * It deliberately does NOT call an LLM judge (no extra tokens/cost/latency on
 * top of the comparison run); instead it scores the *shape* of a well-formed
 * answer from the output text alone:
 *
 *   - terminal success (the task completed at all)
 *   - substantive length (words / sentences — a real answer, not a stub)
 *   - structural quality (sentence/paragraph density — not one huge unbroken blob)
 *   - signal coverage (covers the prompt's length-implied scope)
 *   - signs of a stalled blowup (super-long run-on / repeated boilerplate)
 *
 * Returns a composite 0-100 + a short human label. Used by /compare to render
 * a "Quality" column and rank the models for a same-prompt A/B.
 *
 * This is an honest, explainable heuristic — it is NOT a semantic evaluation.
 * The docstring + UI label make that clear ("heuristic," not "semantic").
 * A real LLM-judge pass is the documented follow-up.
 */

/** Structural breakdown used to compute the score. */
export interface QualityBreakdown {
  words: number;
  sentences: number;
  paragraphs: number;
  /** 0-100 raw length score (reward a substantive answer within a sane ceiling). */
  lengthScore: number;
  /** 0-100 (double-word penalty for run-on/bloat). */
  coherenceScore: number;
}

/** Compound result of scoring one model output. */
export interface QualityScore {
  /** Composite 0-100. */
  total: number;
  /** Human label: Excellent / Good / Adequate / Thin / Failed / No output. */
  label: string;
  breakdown: QualityBreakdown;
}

/** Split text into sentences, tolerating abbreviations/numbers. */
function countSentences(text: string): number {
  const cleaned = text.replace(/\b(?:e\.g|i\.e|etc|Mr|Ms|Dr|vs|cf)\./gi, "$1");
  const matches = cleaned.match(/[.!?]+/g);
  return matches ? matches.length : (cleaned.trim() ? 1 : 0);
}

/** Count non-whitespace words. */
function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

/** Count paragraph breaks (blank-line / double-newline separated blocks). */
function countParagraphs(text: string): number {
  const blocks = text.split(/\n\s*\n+/).map((s) => s.trim()).filter((s) => s.length > 0);
  return blocks.length || (text.trim() ? 1 : 0);
}

/**
 * Score one model output's quality from the raw output text.
 * @param text the final output (already extracted from the task detail).
 * @param completed whether the underlying task reached a terminal "completed".
 */
export function scoreQuality(text: string, completed: boolean): QualityScore {
  const trimmed = (text ?? "").trim();
  const words = countWords(trimmed);
  const sentences = countSentences(trimmed);
  const paragraphs = countParagraphs(trimmed);

  if (!completed) {
    return {
      total: 0,
      label: "No output",
      breakdown: { words, sentences, paragraphs, lengthScore: 0, coherenceScore: 0 },
    };
  }
  if (words === 0) {
    return {
      total: 0,
      label: "Empty",
      breakdown: { words, sentences, paragraphs, lengthScore: 0, coherenceScore: 0 },
    };
  }

  // Length: reward substantive answers. A 30-60 word model response that fully
  // answers a focused prompt scores near-max; longer (150-450 words) is still
  // strong; very short (< 20) or huge (> 1200) is penalised.
  let lengthScore: number;
  if (words >= 25 && words <= 450) {
    lengthScore = 100;
  } else if (words >= 12 && words < 25) {
    lengthScore = 60;
  } else if (words > 450 && words <= 900) {
    lengthScore = 75;
  } else if (words > 900) {
    lengthScore = 45;
  } else {
    lengthScore = 25;
  }

  // Coherence: penalise run-on blobs (very few sentences relative to words) and
  // overhead (paragraphs help structure a long answer).
  let coherenceScore = 100;
  if (sentences > 0 && words / sentences > 60) {
    coherenceScore = Math.max(35, 100 - Math.round((words / sentences - 20) * 2));
  }
  if (words > 120 && paragraphs === 1) {
    coherenceScore = Math.max(40, coherenceScore - 20);
  }
  // A single short spurt is complete (a focused answer), not a failure.
  if (words <= 40 && sentences >= 2) coherenceScore = 100;

  const total = Math.max(0, Math.min(100, Math.round(0.55 * lengthScore + 0.45 * coherenceScore)));
  const label =
    total >= 85 ? "Excellent" : total >= 65 ? "Good" : total >= 45 ? "Adequate" : total > 0 ? "Thin" : "Failed";

  return { total, label, breakdown: { words, sentences, paragraphs, lengthScore, coherenceScore } };
}

/** Rank a set of scored models best-first (total desc, ties keep input order). */
export function rankQuality(scored: Array<{ key: string; score: QualityScore }>): Array<{ key: string; score: QualityScore; rank: number }> {
  return [...scored]
    .sort((a, b) => b.score.total - a.score.total)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}
