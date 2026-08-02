import { Inject, Injectable, Logger } from "@nestjs/common";
import { MODEL_PROVIDERS, type ChatMessage, type ChatResponse, type ModelProvider, type ModelRouterHealth } from "./model-provider.js";

export type { ChatMessage, ChatResponse, ModelRouterHealth, ModelProvider, ModelUsage } from "./model-provider.js";
export { MODEL_PROVIDERS, TokenBudget } from "./model-provider.js";

/**
 * Model router — now an honest SELECTOR over ModelProvider[] (Engine v0.1
 * Task 3). The Ollama HTTP client moved out to `OllamaModelProvider`; this
 * service holds the provider list and delegates chat()/health() to the
 * selected provider, so callers (AgentWorkerService, EngineController) never
 * change when a provider is added or removed.
 *
 * Selection today: first provider wins (only Ollama exists). The seam is real:
 * a fallback/priority policy can be layered here without touching callers.
 */
@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name);

  constructor(@Inject(MODEL_PROVIDERS) private readonly providers: ModelProvider[]) {}

  /** The provider all calls route to today: the first registered. */
  private selectProvider(): ModelProvider {
    const provider = this.providers[0];
    if (!provider) {
      throw new Error("Model router error: no model provider is configured");
    }
    return provider;
  }

  async chat(messages: ChatMessage[], model?: string): Promise<ChatResponse> {
    return this.selectProvider().chat(messages, model);
  }

  async health(): Promise<ModelRouterHealth> {
    const provider = this.providers[0];
    if (!provider) {
      return {
        provider: "none",
        model: "",
        reachable: false,
        error: "No model provider is configured",
      };
    }
    return provider.health();
  }
}
