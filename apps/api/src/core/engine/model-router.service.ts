import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { MODEL_PROVIDERS, type ChatMessage, type ChatResponse, type ModelProvider, type ModelRouterHealth } from "./model-provider.js";
// VALUE import (not `import type`): TracingService is a DI token below; a
// type-only import is erased and @Optional() then injects undefined.
import { TracingService } from "../observability/tracing/tracing.service.js";

export type { ChatMessage, ChatResponse, ModelRouterHealth, ModelProvider, ModelUsage } from "./model-provider.js";
export { MODEL_PROVIDERS, TokenBudget } from "./model-provider.js";

/**
 * Model router — SELECTOR over ModelProvider[] with REAL routing + fallback
 * (Engine v0.3). v0.1 shipped "first provider wins"; v0.3 upgrades the seam
 * into an honest router:
 *
 *   selectProvider(model?)  — no model → Ollama (providers[0], the $0
 *     default); model → the FIRST NON-DEFAULT provider whose
 *     canHandleModel(model) is true (a provider without canHandleModel
 *     handles everything, backward compatible), else the DEFAULT provider
 *     (Ollama) if it claims the id, else the no-match fallback. Scanning
 *     cloud providers BEFORE the default is what lets a bare cloud id like
 *     "deepseek-v4-flash" reach DeepSeek: Ollama's canHandleModel accepts
 *     every non-slash id and sits at providers[0], so a first-match scan
 *     would hand the cloud id to Ollama, which 404s terminally (found live
 *     in the DeepSeek round — the v0.3 order only worked because OpenRouter
 *     ids always contain "/").
 *
 *   chat() — routes to the selected provider, strips the "openrouter:" /
 *     "ollama:" router prefix, and on ANY failure of a NON-default provider
 *     falls back to Ollama (which uses its own DEFAULT_MODEL — the
 *     requested model was meant for the cloud provider). Ollama failing IS
 *     the task failing — no fallback beyond it.
 *
 *   health() — aggregates every provider's verdict; the primary fields are
 *     the first reachable provider's, `providers[]` carries the full
 *     summary. Single-provider health passes through unchanged.
 *
 * Callers (AgentWorkerService, EngineController) never change.
 */
@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name);

  constructor(
    @Inject(MODEL_PROVIDERS) private readonly providers: ModelProvider[],
    @Optional() @Inject(TracingService) private readonly tracing?: TracingService,
  ) {}

  /**
   * Pick the provider for a model request (Engine v0.3, refined 2026-08-04).
   *  - No model → providers[0] (Ollama — the $0 default).
   *  - Model → the FIRST NON-DEFAULT provider that canHandleModel(model)
   *    (a missing canHandleModel = "handles everything"), then the DEFAULT
   *    provider. Cloud providers scan before the default so a bare cloud id
   *    ("deepseek-v4-flash") is not captured by Ollama's permissive
   *    canHandleModel and 404-terminally-failed (the DeepSeek live proof
   *    caught exactly that; the v0.3 first-match order only worked because
   *    OpenRouter ids always contain "/").
   *  - No match → FALL BACK to providers[0] (Ollama) with ITS default model:
   *    the requested model belongs to a provider that isn't available here
   *    (e.g. a "/" cloud id while OpenRouter is unconfigured) — handing the
   *    raw id to Ollama would 404 terminally, so the honest fallback is
   *    Ollama's own DEFAULT_MODEL (same rule as the chat-failure fallback).
   * Returns the provider AND the model to pass it (prefixes already
   * stripped, or undefined = the provider's default).
   */
  private selectProvider(requestedModel?: string): { provider: ModelProvider; model: string | undefined } {
    const fallback = this.providers[0];
    if (!fallback) {
      throw new Error("Model router error: no model provider is configured");
    }
    if (requestedModel == null) return { provider: fallback, model: undefined };
    // Cloud (non-default) providers first: an id they claim (a "/" id for
    // OpenRouter, a bare deepseek-* id for DeepSeek) must never be captured
    // by the default provider's more permissive canHandleModel.
    for (const provider of this.providers.slice(1)) {
      if (provider.canHandleModel?.(requestedModel) ?? true) {
        return { provider, model: this.stripPrefix(requestedModel) };
      }
    }
    // Default provider (Ollama) claims local ids (no slash / its own tags).
    if (fallback.canHandleModel?.(requestedModel) ?? true) {
      return { provider: fallback, model: this.stripPrefix(requestedModel) };
    }
    this.logger.warn(
      `Model router: no provider can handle "${requestedModel}" — falling back to Ollama (${fallback.name}) with its default model`,
    );
    return { provider: fallback, model: undefined };
  }

  /** Strip a provider-routing prefix ("openrouter:", "ollama:", "deepseek:") —
   *  it is for the ROUTER, not the upstream API. */
  private stripPrefix(model?: string): string | undefined {
    if (model == null) return model;
    if (model.startsWith("openrouter:")) return model.slice("openrouter:".length);
    if (model.startsWith("ollama:")) return model.slice("ollama:".length);
    if (model.startsWith("deepseek:")) return model.slice("deepseek:".length);
    return model;
  }

  async chat(messages: ChatMessage[], model?: string): Promise<ChatResponse> {
    const { provider, model: resolvedModel } = this.selectProvider(model);
    // OTel span for every model call (additive — no-op when tracing is
    // disabled). Covers the routed provider AND any fallback (see runChat);
    // usage/cost attach as attributes when the provider reports them.
    if (!this.tracing) {
      return this.runChat(provider, messages, resolvedModel);
    }
    return this.tracing.withSpan(
      "model.call",
      { "gen_ai.provider": provider.name, "gen_ai.request.model": resolvedModel ?? "" },
      async (span) => {
        const response = await this.runChat(provider, messages, resolvedModel);
        if (response.usage) {
          span.setAttributes({
            "gen_ai.usage.input_tokens": response.usage.inputTokens ?? 0,
            "gen_ai.usage.output_tokens": response.usage.outputTokens ?? 0,
            "gen_ai.usage.total_tokens": response.usage.totalTokens ?? 0,
            "gen_ai.usage.cost_usd": response.usage.costUSD ?? 0,
          });
        }
        return response;
      },
    );
  }

  /** The routing + fallback logic of chat() (extracted so tracing wraps it once). */
  private async runChat(provider: ModelProvider, messages: ChatMessage[], resolvedModel: string | undefined): Promise<ChatResponse> {
    try {
      return await provider.chat(messages, resolvedModel);
    } catch (err) {
      // Engine v0.3 fallback: a NON-default provider's failure (OpenRouter
      // hiccup, bad key, quota) falls back to Ollama instead of failing the
      // task. The default provider (Ollama) failing is the task failing.
      if (provider === this.providers[0]) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`${provider.name} chat failed, falling back to Ollama: ${message}`);
      const fallback = this.providers[0];
      if (!fallback) throw err; // no default provider to fall back to
      // The requested model was meant for the cloud provider (e.g. a
      // "org/model" id Ollama doesn't have) — Ollama uses its own
      // DEFAULT_MODEL for the fallback.
      return fallback.chat(messages, undefined);
    }
  }

  async health(): Promise<ModelRouterHealth> {
    if (this.providers.length === 0) {
      return {
        provider: "none",
        model: "",
        reachable: false,
        error: "No model provider is configured",
      };
    }
    // Single provider: pass its verdict through unchanged — the historical
    // shape (no aggregate wrapper) that existing callers/tests expect.
    if (this.providers.length === 1) {
      const provider = this.providers[0]!; // length === 1 guaranteed above
      return provider.health();
    }
    // Multi-provider: aggregate. Primary = first reachable provider's
    // health; providers[] = every provider's individual verdict.
    const all = await Promise.all(this.providers.map((p) => p.health()));
    const primary = all.find((h) => h.reachable) ?? all[0];
    if (!primary) {
      // Unreachable by construction (length >= 2), but be honest if it
      // somehow happens rather than spreading undefined.
      return { provider: "none", model: "", reachable: false, error: "No model provider is configured" };
    }
    return { ...primary, providers: all };
  }
}
