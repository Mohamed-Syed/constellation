import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ModelCallError,
  type ChatMessage,
  type ChatResponse,
  type ModelProvider,
  type ModelRouterHealth,
} from "./model-provider.js";

/**
 * DeepSeek model provider — the THIRD ModelProvider implementation
 * (2026-08-04 round). Direct DeepSeek API access, mirroring the OpenRouter
 * provider's contract: one key unlocks DeepSeek's own models
 * (deepseek-v4-flash / deepseek-v4-pro), routed per task by canHandleModel
 * with fallback to Ollama.
 *
 * OPT-IN BY DESIGN: with DEEPSEEK_API_KEY unset the constructor still
 * succeeds, health() reports the honest reason, and canHandleModel() returns
 * false so the router never selects this provider — nothing crashes, nothing
 * hangs, the engine stays $0/local on Ollama.
 *
 * DeepSeek API reference (https://api-docs.deepseek.com):
 *   POST https://api.deepseek.com/chat/completions   (OpenAI format)
 *   { model, messages, stream: false }
 *   Headers: Authorization: Bearer <key>
 * Token usage is OpenAI-style (prompt_tokens / completion_tokens /
 * total_tokens; the cache-hit share is reported as prompt_cache_hit_tokens).
 * DeepSeek does NOT return a dollar cost — costUSD is DERIVED from the
 * documented list pricing (per 1M tokens) with env-configurable rates,
 * defaults pinned to the deepseek-v4-flash prices on the pricing page:
 * input cache-hit $0.0028 / input cache-miss $0.14 / output $0.28.
 * (The announced peak/off-peak 2x policy is not modeled.)
 *
 * Thinking mode: the engine's ReAct loop asks for exactly one JSON object
 * per turn, so deep chain-of-thought is pure latency. Default is thinking
 * DISABLED ({ "thinking": { "type": "disabled" } }); set DEEPSEEK_THINKING=
 * enabled to keep CoT (the API's default) and optionally
 * DEEPSEEK_REASONING_EFFORT=low|high|max. The chain-of-thought arrives in
 * reasoning_content and is deliberately dropped — the engine never sends
 * `tools` (JSON-action protocol), so the API ignores missing
 * reasoning_content across turns.
 */
@Injectable()
export class DeepSeekModelProvider implements ModelProvider {
  readonly name = "deepseek";
  private readonly logger = new Logger(DeepSeekModelProvider.name);
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;
  private readonly thinkingEnabled: boolean;
  private readonly reasoningEffort: string | undefined;
  /** USD per 1M tokens — derived-cost rates (defaults = v4-flash list prices). */
  private readonly priceInputCacheHitPerMT: number;
  private readonly priceInputPerMT: number;
  private readonly priceOutputPerMT: number;

  constructor(private readonly config: ConfigService) {
    // MUST NOT throw when the key is missing — unconfigured is a supported
    // state (the $0/local invariant), reported honestly by health().
    this.apiKey = config.get<string | undefined>("DEEPSEEK_API_KEY");
    this.baseUrl = config.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com");
    this.defaultModel = config.get("DEEPSEEK_DEFAULT_MODEL", "deepseek-v4-flash");
    this.timeoutMs = Number(config.get("MODEL_TIMEOUT_MS", "60000"));
    this.thinkingEnabled = config.get("DEEPSEEK_THINKING", "disabled") !== "disabled";
    this.reasoningEffort = config.get<string | undefined>("DEEPSEEK_REASONING_EFFORT");
    this.priceInputCacheHitPerMT = Number(config.get("DEEPSEEK_PRICE_INPUT_CACHE_HIT_PER_MT", "0.0028"));
    this.priceInputPerMT = Number(config.get("DEEPSEEK_PRICE_INPUT_PER_MT", "0.14"));
    this.priceOutputPerMT = Number(config.get("DEEPSEEK_PRICE_OUTPUT_PER_MT", "0.28"));
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
        "Model router error: DEEPSEEK_API_KEY is not set — cannot call DeepSeek",
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
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages,
          stream: false,
          ...this.thinkingBody(),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        // 5xx = DeepSeek overloaded → TRANSIENT (retryable);
        // 401/403 = bad key / 4xx = bad request or unknown model → TERMINAL.
        throw new ModelCallError(
          `Model router error: DeepSeek returned HTTP ${res.status}: ${body.slice(0, 200)}`,
          res.status >= 500,
        );
      }

      const data = (await res.json()) as DeepSeekChatCompletion;
      const content = data.choices?.[0]?.message?.content ?? "";
      const inputTokens = data.usage?.prompt_tokens;
      const outputTokens = data.usage?.completion_tokens;
      const totalTokens = data.usage?.total_tokens;
      const costUSD = this.deriveCostUSD(data);

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
        this.logger.error(`DeepSeek chat failed (model=${resolvedModel}): ${err.message}`);
        throw err;
      }
      // Network failure / abort / anything unexpected from the transport is
      // a TRANSIENT condition (DeepSeek hiccup, slow cloud cold-start
      // exceeding MODEL_TIMEOUT_MS) — the worker retries it.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`DeepSeek chat failed (model=${resolvedModel}): ${message}`);
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
        error: "DEEPSEEK_API_KEY is not set",
      };
    }
    // Key is set → available by construction: there is no local process to
    // probe (a live probe would consume a paid call). The router treats this
    // as reachable and chat() surfaces any real failure at call time.
    return { provider: this.name, model: this.defaultModel, reachable: true };
  }

  /** Whether this provider can serve `model` (real routing, Engine v0.3). */
  canHandleModel(model?: string): boolean {
    if (!this.keyIsSet) return false; // unconfigured → never selected
    if (model == null) return true; // no preference → we're available
    // DeepSeek model ids are bare (deepseek-v4-flash / deepseek-v4-pro);
    // the "deepseek:" prefix is the explicit router hint. Slash ids
    // ("org/model") belong to OpenRouter — refuse them here.
    if (model.startsWith("deepseek:")) return true;
    if (model.startsWith("deepseek-")) return true;
    return false;
  }

  /** Body fragment controlling thinking mode (the API's default is enabled). */
  private thinkingBody(): Record<string, unknown> {
    if (this.thinkingEnabled) {
      return {
        thinking: { type: "enabled" },
        ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
      };
    }
    return { thinking: { type: "disabled" } };
  }

  /**
   * DeepSeek cost → USD number. DeepSeek does not return a cost field, so the
   * cost is DERIVED from the documented list pricing (defaults = v4-flash):
   *   costUSD = (cacheHit × hitRate + (input − cacheHit) × missRate
   *              + output × outRate) / 1e6
   * The rates are env-configurable (DEEPSEEK_PRICE_*_PER_MT) so pro-model or
   * future price changes are a config change, not a code change. Returns
   * undefined when no usage is present. (Peak/off-peak 2x not modeled.)
   */
  private deriveCostUSD(data: DeepSeekChatCompletion): number | undefined {
    const input = data.usage?.prompt_tokens;
    const output = data.usage?.completion_tokens;
    if (input == null || output == null) return undefined;
    const hit = data.usage?.prompt_cache_hit_tokens ?? 0;
    const miss = Math.max(0, input - hit);
    return (
      (hit * this.priceInputCacheHitPerMT +
        miss * this.priceInputPerMT +
        output * this.priceOutputPerMT) /
      1e6
    );
  }
}

/** OpenAI-compatible chat completion as DeepSeek returns it. */
interface DeepSeekChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    /** Cache-hit share of the prompt tokens (DeepSeek-specific). */
    prompt_cache_hit_tokens?: number;
  };
}
