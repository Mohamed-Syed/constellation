/**
 * Model provider boundary — the honest "router" seam (Engine v0.1 Task 3).
 *
 * Before this file, `ModelRouterService` was an Ollama client wearing a
 * router's name: no provider interface, no selection, no cost cap. Now:
 *
 *   ModelProvider  (interface: chat + health)      <- this file
 *   OllamaModelProvider                            <- first implementation
 *   ModelRouterService                             <- thin selector over
 *                                                     ModelProvider[]
 *
 * A second provider (Claude, GPT, …) can be added WITHOUT touching callers
 * (AgentWorkerService, EngineController) — they only ever see
 * ModelRouterService's chat()/health().
 */

/** One chat turn. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Token accounting for one model call (the budget-cap seam).
 *
 * Ollama reports `prompt_eval_count` / `eval_count` on non-stream /api/chat
 * responses; a paid provider would report the same from its usage payload.
 * Fields are optional — a provider that omits usage simply contributes 0 to
 * the per-task token ceiling (the ceiling is best-effort on providers that
 * don't report; documented in `.env.example`).
 */
export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: string;
  durationMs: number;
  /** Token usage for this call — the seam the budget cap (and, for a paid
   *  provider, a dollar-cap) is enforced on. */
  usage?: ModelUsage;
}

export interface ModelRouterHealth {
  provider: string;
  model: string;
  reachable: boolean;
  error?: string;
}

/** A backend that can chat and report its own health. */
export interface ModelProvider {
  readonly name: string;
  chat(messages: ChatMessage[], model?: string): Promise<ChatResponse>;
  health(): Promise<ModelRouterHealth>;
}

/**
 * A model-call failure. `transient` distinguishes the retryable class from
 * the terminal one (Engine v0.1 Task 5): a 1-second Ollama hiccup (network
 * blip, 5xx, slow cold-load timeout) must NOT kill a long task, while a 4xx
 * (unknown model, bad request) is terminal and must fail immediately.
 */
export class ModelCallError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "ModelCallError";
  }
}

/** Bounded retry of transient model-call failures (Engine v0.1 Task 5). */
export interface RetryOptions {
  /** Retries AFTER the first failure (total calls = maxAttempts + 1). */
  maxAttempts: number;
  /** Backoff in ms for each retry, keyed by the attempt index (0-based). */
  delayMs: (attempt: number) => number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn`, retrying only `ModelCallError` failures marked `transient`,
 * up to `maxAttempts` retries with the given backoff. Terminal errors
 * (non-transient) and retries exhausted propagate immediately — the caller
 * (AgentWorkerService) turns the final failure into an honest task failure.
 */
export async function retryTransient<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable = err instanceof ModelCallError && err.transient;
      if (!retryable || attempt >= options.maxAttempts) throw err;
      await sleep(options.delayMs(attempt));
    }
  }
}

/** NestJS multi-provider token — ModelRouterService injects ModelProvider[]. */
export const MODEL_PROVIDERS = Symbol("MODEL_PROVIDERS");

/**
 * Per-task token ceiling tracker (the "hard budget cap" the design promised).
 *
 * The worker creates one per task (ceiling = task.maxTokens ?? platform
 * default) and records every model call's usage. `record()` returns false the
 * moment the cumulative count crosses the ceiling — the worker then stops the
 * task with an honest terminal error instead of burning unbounded tokens.
 *
 * Dollar-cap seam (documented, not implemented — Ollama is free): a paid
 * provider would carry a cost in its usage payload and the SAME tracker
 * shape would sum spend instead of tokens; the enforcement point (worker
 * loop) is identical.
 */
export class TokenBudget {
  private _used = 0;

  constructor(public readonly ceiling: number) {}

  get used(): number {
    return this._used;
  }

  get remaining(): number {
    return Math.max(0, this.ceiling - this._used);
  }

  /** Record one call's usage; returns true while still within the ceiling. */
  record(usage?: ModelUsage): boolean {
    // Prefer the provider's total; fall back to summing the parts.
    const total = usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
    this._used += total;
    return this._used <= this.ceiling;
  }
}
