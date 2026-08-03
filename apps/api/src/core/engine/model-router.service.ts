import { Inject, Injectable, Logger } from "@nestjs/common";
import { MODEL_PROVIDERS, type ChatMessage, type ChatResponse, type ModelProvider, type ModelRouterHealth } from "./model-provider.js";

export type { ChatMessage, ChatResponse, ModelRouterHealth, ModelProvider, ModelUsage } from "./model-provider.js";
export { MODEL_PROVIDERS, TokenBudget } from "./model-provider.js";

/**
 * Model router — SELECTOR over ModelProvider[] with REAL routing + fallback
 * (Engine v0.3). v0.1 shipped "first provider wins"; v0.3 upgrades the seam
 * into an honest router:
 *
 *   selectProvider(model?)  — no model → Ollama (providers[0], the $0
 *     default); model → the FIRST provider whose canHandleModel(model) is
 *     true (a provider without canHandleModel handles everything, backward
 *     compatible); no match → Ollama.
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

  constructor(@Inject(MODEL_PROVIDERS) private readonly providers: ModelProvider[]) {}

  /**
   * Pick the provider for a model request.
   *  - No model → providers[0] (Ollama — the $0 default).
   *  - Model → the FIRST provider that canHandleModel(model) (a missing
   *    canHandleModel = "handles everything").
   *  - No match → providers[0] (Ollama): the task's cloud model isn't
   *    available here, so Ollama tries it and fails terminally if it
   *    doesn't have it — better than a phantom provider error.
   */
  private selectProvider(requestedModel?: string): ModelProvider {
    const fallback = this.providers[0];
    if (!fallback) {
      throw new Error("Model router error: no model provider is configured");
    }
    if (requestedModel == null) return fallback;
    return this.providers.find((p) => p.canHandleModel?.(requestedModel) ?? true) ?? fallback;
  }

  /** Strip a provider-routing prefix ("openrouter:", "ollama:") — it is for
   *  the ROUTER, not the upstream API. */
  private stripPrefix(model?: string): string | undefined {
    if (model == null) return model;
    if (model.startsWith("openrouter:")) return model.slice("openrouter:".length);
    if (model.startsWith("ollama:")) return model.slice("ollama:".length);
    return model;
  }

  async chat(messages: ChatMessage[], model?: string): Promise<ChatResponse> {
    const provider = this.selectProvider(model);
    try {
      return await provider.chat(messages, this.stripPrefix(model));
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
