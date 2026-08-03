import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModelCallError, type ChatMessage, type ChatResponse, type ModelProvider, type ModelRouterHealth } from "./model-provider.js";

/**
 * OpenRouter model provider — the SECOND ModelProvider implementation
 * (Engine v0.3). One OpenAI-compatible key unlocks dozens of cloud models
 * (GPT-OSS, Qwen, DeepSeek, Claude, Gemini, …) via OpenRouter's aggregation
 * API, and the router can route per-task models to it with fallback.
 *
 * OPT-IN BY DESIGN: with OPENROUTER_API_KEY unset the constructor still
 * succeeds, health() reports the honest reason, and canHandleModel() returns
 * false so the router never selects this provider — nothing crashes, nothing
 * hangs, the engine stays $0/local on Ollama.
 *
 * OpenRouter API reference: POST <base>/chat/completions
 *   { model, messages, stream: false }   (OpenAI-compatible)
 * Headers: Authorization: Bearer <key> (HTTP-Referer / X-Title are optional
 * attribution hints, harmless local-dev values).
 * Token usage comes from the OpenAI-style usage payload (prompt_tokens /
 * completion_tokens / total_tokens); the dollar cost from usage.cost (USD)
 * when OpenRouter knows the model's price — the cost-aware budget seam now
 * has real data flowing through it (see ModelUsage.costUSD).
 */
@Injectable()
export class OpenRouterModelProvider implements ModelProvider {
  readonly name = "openrouter";
  private readonly logger = new Logger(OpenRouterModelProvider.name);
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;

  constructor(private readonly config: ConfigService) {
    // MUST NOT throw when the key is missing — unconfigured is a supported
    // state (the $0/local invariant), reported honestly by health().
    this.apiKey = config.get<string | undefined>("OPENROUTER_API_KEY");
    this.baseUrl = config.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
    this.defaultModel = config.get("OPENROUTER_DEFAULT_MODEL", "openai/gpt-oss-120b");
    this.timeoutMs = Number(config.get("MODEL_TIMEOUT_MS", "60000"));
  }

  /** True only when a non-empty key is configured — the opt-in switch. */
  private get keyIsSet(): boolean {
    return this.apiKey != null && this.apiKey.trim() !== "";
  }

  async chat(messages: ChatMessage[], model?: string): Promise<ChatResponse> {
    const resolvedModel = model ?? this.defaultModel;

    // Honest failure instead of a doomed request: with no key the router
    // should never have selected us (canHandleModel → false), but a direct
    // call still fails cleanly rather than POSTing "Bearer undefined".
    if (!this.keyIsSet) {
      throw new ModelCallError(
        "Model router error: OPENROUTER_API_KEY is not set — cannot call OpenRouter",
        false,
      );
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": "http://localhost:3005",
          "X-Title": "Constellation",
        },
        body: JSON.stringify({ model: resolvedModel, messages, stream: false }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        // 5xx = OpenRouter overloaded → TRANSIENT (retryable);
        // 401/403 = bad key / 4xx = bad request or unknown model → TERMINAL.
        throw new ModelCallError(
          `Model router error: OpenRouter returned HTTP ${res.status}: ${body.slice(0, 200)}`,
          res.status >= 500,
        );
      }

      const data = (await res.json()) as OpenRouterChatCompletion;
      const content = data.choices?.[0]?.message?.content ?? "";
      const inputTokens = data.usage?.prompt_tokens;
      const outputTokens = data.usage?.completion_tokens;
      const totalTokens = data.usage?.total_tokens;
      const costUSD = parseCostUSD(data);

      return {
        content,
        model: data.model ?? resolvedModel,
        provider: this.name,
        durationMs: Date.now() - started,
        usage:
          inputTokens != null || outputTokens != null || totalTokens != null || costUSD != null
            ? {
                inputTokens: inputTokens ?? 0,
                outputTokens: outputTokens ?? 0,
                totalTokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0),
                ...(costUSD != null ? { costUSD } : {}),
              }
            : undefined,
      };
    } catch (err) {
      if (err instanceof ModelCallError) {
        this.logger.error(`OpenRouter chat failed (model=${resolvedModel}): ${err.message}`);
        throw err;
      }
      // Network failure / abort / anything unexpected from the transport is
      // a TRANSIENT condition (OpenRouter hiccup, slow cloud cold-start
      // exceeding MODEL_TIMEOUT_MS) — the worker retries it.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`OpenRouter chat failed (model=${resolvedModel}): ${message}`);
      throw new ModelCallError(`Model router error: ${message}`, true);
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<ModelRouterHealth> {
    // Unconfigured is NOT a crash: report the honest reason. MUST never
    // throw — the boot path calls health() for every provider.
    if (!this.keyIsSet) {
      return {
        provider: this.name,
        model: "",
        reachable: false,
        error: "OPENROUTER_API_KEY is not set",
      };
    }
    // Key is set → available by construction: there is no local process to
    // probe (a live probe would consume a paid call). The router treats this
    // as reachable and chat() surfaces any real failure at call time.
    return { provider: this.name, model: this.defaultModel, reachable: true };
  }

  /** Whether this provider can serve `model` (Engine v0.3 real routing). */
  canHandleModel(model?: string): boolean {
    if (!this.keyIsSet) return false; // unconfigured → never selected
    if (model == null) return true; // no preference → we're available
    // OpenRouter model ids are "org/model" (always contain "/"); the
    // "openrouter:" prefix is the explicit router hint.
    if (model.includes("/")) return true;
    if (model.startsWith("openrouter:")) return true;
    return false;
  }
}

/** OpenAI-compatible chat completion as OpenRouter returns it. */
interface OpenRouterChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    /** Total cost in USD — OpenRouter fills this when it knows the price. */
    cost?: number | string;
    /** Per-token prices (strings like "$0.0000005" or numbers). */
    pricing?: { prompt?: number | string; completion?: number | string };
  };
  /** Top-level per-token pricing (defensive; OpenRouter sends it under usage). */
  pricing?: { prompt?: number | string; completion?: number | string };
}

/** Coerce OpenRouter's numeric-or-"$0.0001"-string price to a number. */
function toNumber(v: number | string | undefined): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = parseFloat(v.replace("$", ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * OpenRouter cost → USD number.
 *  1. usage.cost (the total, when OpenRouter reports it) wins.
 *  2. Otherwise derive it from per-token pricing × token counts
 *     (pricing lives under usage.pricing; the top-level `pricing` is read
 *     defensively).
 * Returns undefined when no pricing info is available — costUSD stays off
 * the usage record and the token budget remains the only enforced cap.
 */
function parseCostUSD(data: OpenRouterChatCompletion): number | undefined {
  const total = toNumber(data.usage?.cost);
  if (total != null) return total;

  const pricing = data.usage?.pricing ?? data.pricing;
  const promptPrice = toNumber(pricing?.prompt);
  const completionPrice = toNumber(pricing?.completion);
  if (promptPrice != null && completionPrice != null) {
    const input = data.usage?.prompt_tokens ?? 0;
    const output = data.usage?.completion_tokens ?? 0;
    return input * promptPrice + output * completionPrice;
  }
  return undefined;
}
