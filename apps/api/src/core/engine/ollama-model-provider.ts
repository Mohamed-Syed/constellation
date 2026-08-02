import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ChatMessage, ChatResponse, ModelProvider, ModelRouterHealth } from "./model-provider.js";

/**
 * Ollama model provider — the first ModelProvider implementation.
 *
 * Ollama API reference: POST /api/chat  { model, messages, stream: false }
 * Expects Ollama running at OLLAMA_BASE_URL (default http://localhost:11434).
 * Token usage is parsed from the non-stream response's `prompt_eval_count` /
 * `eval_count` fields (absent when the server omits them → usage contributes 0
 * to the per-task token ceiling).
 */
@Injectable()
export class OllamaModelProvider implements ModelProvider {
  readonly name = "ollama";
  private readonly logger = new Logger(OllamaModelProvider.name);
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = config.get("OLLAMA_BASE_URL", "http://localhost:11434");
    this.defaultModel = config.get("DEFAULT_MODEL", "llama3.2");
    this.timeoutMs = Number(config.get("MODEL_TIMEOUT_MS", "60000"));
  }

  async chat(messages: ChatMessage[], model?: string): Promise<ChatResponse> {
    const resolvedModel = model ?? this.defaultModel;
    const started = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: resolvedModel, messages, stream: false }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Ollama returned HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        message?: { content?: string };
        model?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const content = data.message?.content ?? "";
      const inputTokens = data.prompt_eval_count;
      const outputTokens = data.eval_count;

      return {
        content,
        model: data.model ?? resolvedModel,
        provider: this.name,
        durationMs: Date.now() - started,
        usage:
          inputTokens != null || outputTokens != null
            ? {
                inputTokens: inputTokens ?? 0,
                outputTokens: outputTokens ?? 0,
                totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
              }
            : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Ollama chat failed (model=${resolvedModel}): ${message}`);
      throw new Error(`Model router error: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<ModelRouterHealth> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
        clearTimeout(timer);
        return { provider: this.name, model: this.defaultModel, reachable: res.ok };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return {
        provider: this.name,
        model: this.defaultModel,
        reachable: false,
        error: `Ollama unreachable at ${this.baseUrl}`,
      };
    }
  }
}
