import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: string;
  durationMs: number;
}

export interface ModelRouterHealth {
  provider: string;
  model: string;
  reachable: boolean;
  error?: string;
}

/**
 * Provider-agnostic model router. Today: Ollama (local, $0).
 * Designed as an interface boundary — additional providers (Claude, GPT)
 * slot in without touching callers.
 *
 * Ollama API reference: POST /api/chat  { model, messages, stream: false }
 * Expects Ollama running at OLLAMA_BASE_URL (default http://localhost:11434).
 */
@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name);
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

      const data = (await res.json()) as { message?: { content?: string }; model?: string };
      const content = data.message?.content ?? "";

      return {
        content,
        model: data.model ?? resolvedModel,
        provider: "ollama",
        durationMs: Date.now() - started,
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
        return { provider: "ollama", model: this.defaultModel, reachable: res.ok };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return {
        provider: "ollama",
        model: this.defaultModel,
        reachable: false,
        error: `Ollama unreachable at ${this.baseUrl}`,
      };
    }
  }
}
