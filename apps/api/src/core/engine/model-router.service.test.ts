import { describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import type { ModelProvider } from "./model-provider.js";
import { ModelCallError, TokenBudget, retryTransient } from "./model-provider.js";
import { ModelRouterService, type ChatMessage } from "./model-router.service.js";

/**
 * ModelRouterService tests — the SELECTOR (Engine v0.1 Task 3). The Ollama
 * HTTP client is now `OllamaModelProvider` (tested in
 * `ollama-model-provider.test.ts`); here the router is exercised as a thin
 * delegator over ModelProvider[], plus the TokenBudget ceiling tracker.
 */

function makeProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    name: "fake",
    chat: vi.fn(async () => ({ content: "hi", model: "fake", provider: "fake", durationMs: 1 })),
    health: vi.fn(async () => ({ provider: "fake", model: "fake", reachable: true })),
    ...overrides,
  };
}

const messages: ChatMessage[] = [{ role: "user", content: "Say hello" }];

/**
 * Engine v0.3 provider fakes — stand-ins for the real Ollama/OpenRouter
 * providers, carrying the canHandleModel routing semantics the router
 * selects on (no real HTTP anywhere in this file).
 */
function makeOllamaProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return makeProvider({
    name: "ollama",
    chat: vi.fn(async () => ({ content: "ollama says hi", model: "qwen2.5-coder:7b", provider: "ollama", durationMs: 1 })),
    // Ollama is the $0 default: no preference or plain/local names → yes;
    // "org/model" cloud ids → no.
    canHandleModel: (model?: string) => model === undefined || !model.includes("/"),
    ...overrides,
  });
}

function makeOpenRouterProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return makeProvider({
    name: "openrouter",
    chat: vi.fn(async () => ({ content: "cloud says hi", model: "openai/gpt-oss-120b", provider: "openrouter", durationMs: 1 })),
    // Slash-style ids and the explicit openrouter: prefix are OpenRouter's.
    canHandleModel: (model?: string) => model !== undefined && (model.includes("/") || model.startsWith("openrouter:")),
    ...overrides,
  });
}

describe("ModelRouterService — selection", () => {
  it("delegates chat() to the first registered provider", async () => {
    const provider = makeProvider();
    const router = new ModelRouterService([provider]);

    const res = await router.chat(messages, "qwen2.5");

    expect(provider.chat).toHaveBeenCalledWith(messages, "qwen2.5");
    expect(res.provider).toBe("fake");
  });

  it("delegates health() to the first registered provider", async () => {
    const provider = makeProvider();
    const router = new ModelRouterService([provider]);

    await expect(router.health()).resolves.toEqual({
      provider: "fake",
      model: "fake",
      reachable: true,
    });
    expect(provider.health).toHaveBeenCalledOnce();
  });

  it("routes through the first provider when several are registered (a second can be added without touching callers)", async () => {
    const first = makeProvider({ name: "first" });
    const second = makeProvider({ name: "second" });
    const router = new ModelRouterService([first, second]);

    await router.chat(messages);

    expect(first.chat).toHaveBeenCalledOnce();
    expect(second.chat).not.toHaveBeenCalled();
  });

  it("throws a clear error from chat() when no provider is configured", async () => {
    const router = new ModelRouterService([]);

    await expect(router.chat(messages)).rejects.toThrow(/no model provider is configured/);
  });

  it("reports an honest unreachable health when no provider is configured", async () => {
    const router = new ModelRouterService([]);

    await expect(router.health()).resolves.toEqual({
      provider: "none",
      model: "",
      reachable: false,
      error: "No model provider is configured",
    });
  });
});

describe("TokenBudget — the per-task token ceiling (the promised 'budget cap')", () => {
  it("accumulates usage and stays within the ceiling", () => {
    const budget = new TokenBudget(100);
    expect(budget.record({ totalTokens: 40 })).toBe(true);
    expect(budget.record({ totalTokens: 60 })).toBe(true); // exactly at the ceiling
    expect(budget.used).toBe(100);
    expect(budget.remaining).toBe(0);
  });

  it("crossing the ceiling returns false — the worker must stop the task", () => {
    const budget = new TokenBudget(100);
    expect(budget.record({ totalTokens: 99 })).toBe(true);
    expect(budget.record({ totalTokens: 2 })).toBe(false); // 101 > 100
    expect(budget.used).toBe(101);
  });

  it("falls back to summing input+output when totalTokens is absent", () => {
    const budget = new TokenBudget(100);
    expect(budget.record({ inputTokens: 30, outputTokens: 20 })).toBe(true);
    expect(budget.used).toBe(50);
  });

  it("a provider that omits usage contributes 0 (best-effort ceiling)", () => {
    const budget = new TokenBudget(100);
    expect(budget.record(undefined)).toBe(true);
    expect(budget.record({})).toBe(true);
    expect(budget.used).toBe(0);
  });

  it("accumulates input/output tokens and cost across calls (multi-model compare round)", () => {
    const budget = new TokenBudget(1000);
    budget.record({ inputTokens: 100, outputTokens: 50, totalTokens: 150, costUSD: 0.001 });
    budget.record({ inputTokens: 200, outputTokens: 100, totalTokens: 300, costUSD: 0.002 });
    expect(budget.inputTokens).toBe(300);
    expect(budget.outputTokens).toBe(150);
    expect(budget.totalTokens).toBe(450);
    expect(budget.costUSD).toBeCloseTo(0.003);
  });
});

describe("retryTransient — bounded retry of TRANSIENT model failures (Task 5)", () => {
  it("retries a transient failure until it succeeds, then returns the value", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ModelCallError("Model router error: fetch failed", true))
      .mockResolvedValueOnce("ok");

    await expect(
      retryTransient(fn, { maxAttempts: 3, delayMs: () => 0 }),
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after the bounded retries are exhausted and propagates the error", async () => {
    const fn = vi.fn().mockRejectedValue(new ModelCallError("Model router error: fetch failed", true));

    await expect(
      retryTransient(fn, { maxAttempts: 2, delayMs: () => 0 }),
    ).rejects.toThrow("Model router error: fetch failed");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does NOT retry a TERMINAL failure (4xx / unknown model) — fails immediately", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ModelCallError("Model router error: Ollama returned HTTP 404: model not found", false))
      .mockResolvedValueOnce("ok");

    await expect(
      retryTransient(fn, { maxAttempts: 3, delayMs: () => 0 }),
    ).rejects.toThrow("HTTP 404");
    expect(fn).toHaveBeenCalledTimes(1); // terminal → no retry
  });

  it("does NOT retry a non-ModelCallError (unexpected) failure", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");

    await expect(retryTransient(fn, { maxAttempts: 3, delayMs: () => 0 })).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("applies the backoff delay between retries", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ModelCallError("Model router error: fetch failed", true))
      .mockResolvedValueOnce("ok");
    const delays: number[] = [];
    const started = Date.now();

    await retryTransient(fn, {
      maxAttempts: 3,
      delayMs: (attempt) => {
        delays.push(attempt);
        return 30;
      },
    });

    expect(delays).toEqual([0]); // one backoff for the one retry
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
  });
});

describe("ModelRouterService — real routing by canHandleModel (Engine v0.3)", () => {
  it("routes a slash-style model id to the OpenRouter provider", async () => {
    const ollama = makeOllamaProvider();
    const openrouter = makeOpenRouterProvider();
    const router = new ModelRouterService([ollama, openrouter]);

    const res = await router.chat(messages, "openai/gpt-oss-120b");

    expect(openrouter.chat).toHaveBeenCalledWith(messages, "openai/gpt-oss-120b");
    expect(ollama.chat).not.toHaveBeenCalled();
    expect(res.provider).toBe("openrouter");
  });

  it("routes a local-style model id (no slash) to the Ollama provider", async () => {
    const ollama = makeOllamaProvider();
    const openrouter = makeOpenRouterProvider();
    const router = new ModelRouterService([ollama, openrouter]);

    const res = await router.chat(messages, "qwen2.5-coder:7b");

    expect(ollama.chat).toHaveBeenCalledWith(messages, "qwen2.5-coder:7b");
    expect(openrouter.chat).not.toHaveBeenCalled();
    expect(res.provider).toBe("ollama");
  });

  it("routes a BARE cloud model id to the cloud provider even though Ollama also claims non-slash ids (DeepSeek regression)", async () => {
    // The DeepSeek live proof found this: "deepseek-v4-flash" has no "/", so
    // Ollama's canHandleModel (accepts every non-slash id) matched FIRST in
    // the old first-match scan and the task died with "model
    // 'deepseek-v4-flash' not found" from Ollama. Cloud providers must scan
    // BEFORE the default provider.
    const ollama = makeOllamaProvider();
    const openrouter = makeOpenRouterProvider();
    const deepseek = makeProvider({
      name: "deepseek",
      chat: vi.fn(async () => ({ content: "deepseek says hi", model: "deepseek-v4-flash", provider: "deepseek", durationMs: 1 })),
      canHandleModel: (model?: string) =>
        model !== undefined && (model.startsWith("deepseek:") || model.startsWith("deepseek-")),
    });
    const router = new ModelRouterService([ollama, openrouter, deepseek]);

    const res = await router.chat(messages, "deepseek-v4-flash");

    expect(deepseek.chat).toHaveBeenCalledWith(messages, "deepseek-v4-flash");
    expect(ollama.chat).not.toHaveBeenCalled();
    expect(openrouter.chat).not.toHaveBeenCalled();
    expect(res.provider).toBe("deepseek");
  });

  it("strips the deepseek: prefix before calling the DeepSeek provider", async () => {
    const ollama = makeOllamaProvider();
    const deepseek = makeProvider({
      name: "deepseek",
      chat: vi.fn(async () => ({ content: "deepseek says hi", model: "deepseek-v4-flash", provider: "deepseek", durationMs: 1 })),
      canHandleModel: (model?: string) =>
        model !== undefined && (model.startsWith("deepseek:") || model.startsWith("deepseek-")),
    });
    const router = new ModelRouterService([ollama, deepseek]);

    await router.chat(messages, "deepseek:deepseek-v4-flash");

    expect(deepseek.chat).toHaveBeenCalledWith(messages, "deepseek-v4-flash");
    expect(ollama.chat).not.toHaveBeenCalled();
  });

  it("defaults to the Ollama provider when no model is specified ($0 default)", async () => {
    const ollama = makeOllamaProvider();
    const openrouter = makeOpenRouterProvider();
    const router = new ModelRouterService([ollama, openrouter]);

    const res = await router.chat(messages);

    expect(ollama.chat).toHaveBeenCalledWith(messages, undefined);
    expect(openrouter.chat).not.toHaveBeenCalled();
    expect(res.provider).toBe("ollama");
  });

  it("strips the openrouter: prefix before calling OpenRouter (it is for the router, not the API)", async () => {
    const ollama = makeOllamaProvider();
    const openrouter = makeOpenRouterProvider();
    const router = new ModelRouterService([ollama, openrouter]);

    await router.chat(messages, "openrouter:openai/gpt-oss-120b");

    expect(openrouter.chat).toHaveBeenCalledWith(messages, "openai/gpt-oss-120b");
    expect(ollama.chat).not.toHaveBeenCalled();
  });

  it("strips the ollama: prefix before calling Ollama", async () => {
    const ollama = makeOllamaProvider();
    const openrouter = makeOpenRouterProvider();
    const router = new ModelRouterService([ollama, openrouter]);

    await router.chat(messages, "ollama:qwen2.5-coder:7b");

    expect(ollama.chat).toHaveBeenCalledWith(messages, "qwen2.5-coder:7b");
    expect(openrouter.chat).not.toHaveBeenCalled();
  });

  it("when NO provider matches, falls back to Ollama with ITS default model (not the raw cloud id)", async () => {
    // OpenRouter unavailable (key unset → canHandleModel false everywhere),
    // and Ollama refuses the "/" cloud id → the router's no-match rule kicks
    // in: it must NOT hand the raw id to Ollama (that would 404 terminally) —
    // it falls back to Ollama's own DEFAULT_MODEL, exactly like the
    // chat-failure fallback (this is what makes a "/" model task COMPLETE on
    // Ollama when OpenRouter is unconfigured — Task 8 live proof).
    const warnSpy = vi.spyOn(Logger.prototype, "warn");
    const ollama = makeOllamaProvider();
    const openrouter = makeOpenRouterProvider({ canHandleModel: () => false });
    const router = new ModelRouterService([ollama, openrouter]);

    const res = await router.chat(messages, "openai/gpt-oss-120b");

    expect(ollama.chat).toHaveBeenCalledWith(messages, undefined);
    expect(openrouter.chat).not.toHaveBeenCalled();
    expect(res.provider).toBe("ollama");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("falling back to ollama"));
    warnSpy.mockRestore();
  });
});

describe("ModelRouterService — fallback to Ollama on provider failure (Engine v0.3)", () => {
  it("OpenRouter TRANSIENT failure → logs and falls back to Ollama with DEFAULT_MODEL", async () => {
    const warnSpy = vi.spyOn(Logger.prototype, "warn");
    const ollama = makeOllamaProvider();
    const openrouter = makeOpenRouterProvider({
      chat: vi.fn(async () => {
        throw new ModelCallError("OpenRouter 503: overloaded", true);
      }),
    });
    const router = new ModelRouterService([ollama, openrouter]);

    const res = await router.chat(messages, "openai/gpt-oss-120b");

    // Fallback: Ollama is called WITHOUT the cloud model — it uses its own
    // DEFAULT_MODEL (the requested "/" model was meant for OpenRouter).
    expect(ollama.chat).toHaveBeenCalledWith(messages, undefined);
    expect(res.provider).toBe("ollama");
    expect(res.content).toBe("ollama says hi");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("falling back to ollama"));
    warnSpy.mockRestore();
  });

  it("OpenRouter TERMINAL failure (bad key) also falls back — the fallback is not transient-only", async () => {
    const ollama = makeOllamaProvider();
    const openrouter = makeOpenRouterProvider({
      chat: vi.fn(async () => {
        throw new ModelCallError("OpenRouter 401: invalid api key", false);
      }),
    });
    const router = new ModelRouterService([ollama, openrouter]);

    const res = await router.chat(messages, "openai/gpt-oss-120b");

    expect(ollama.chat).toHaveBeenCalledWith(messages, undefined);
    expect(res.provider).toBe("ollama");
  });

  it("an Ollama failure is NOT re-routed — it propagates (Ollama failing is the task failing)", async () => {
    const ollama = makeOllamaProvider({
      chat: vi.fn(async () => {
        throw new ModelCallError("Ollama 404: model not found", false);
      }),
    });
    const openrouter = makeOpenRouterProvider();
    const router = new ModelRouterService([ollama, openrouter]);

    await expect(router.chat(messages, "qwen2.5-coder:7b")).rejects.toMatchObject({
      transient: false,
      message: expect.stringContaining("Ollama 404"),
    });
    expect(openrouter.chat).not.toHaveBeenCalled();
  });
});

describe("ModelRouterService — aggregated health (Engine v0.3)", () => {
  it("aggregates both providers when they are reachable — primary is the first reachable", async () => {
    const ollama = makeOllamaProvider({
      health: vi.fn(async () => ({ provider: "ollama", model: "qwen2.5-coder:7b", reachable: true })),
    });
    const openrouter = makeOpenRouterProvider({
      health: vi.fn(async () => ({ provider: "openrouter", model: "openai/gpt-oss-120b", reachable: true })),
    });
    const router = new ModelRouterService([ollama, openrouter]);

    await expect(router.health()).resolves.toEqual({
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      reachable: true,
      providers: [
        { provider: "ollama", model: "qwen2.5-coder:7b", reachable: true },
        { provider: "openrouter", model: "openai/gpt-oss-120b", reachable: true },
      ],
    });
  });

  it("reports the engine available when at least Ollama is reachable even if OpenRouter is unconfigured", async () => {
    const ollama = makeOllamaProvider({
      health: vi.fn(async () => ({ provider: "ollama", model: "qwen2.5-coder:7b", reachable: true })),
    });
    const openrouter = makeOpenRouterProvider({
      health: vi.fn(async () => ({ provider: "openrouter", model: "", reachable: false, error: "OPENROUTER_API_KEY is not set" })),
    });
    const router = new ModelRouterService([ollama, openrouter]);

    const health = await router.health();

    expect(health.reachable).toBe(true);
    expect(health.provider).toBe("ollama");
    expect(health.providers).toHaveLength(2);
    expect(health.providers![1]).toEqual({
      provider: "openrouter",
      model: "",
      reachable: false,
      error: "OPENROUTER_API_KEY is not set",
    });
  });

  it("keeps the single-provider passthrough shape (no aggregate wrapper)", async () => {
    const ollama = makeOllamaProvider({
      health: vi.fn(async () => ({ provider: "ollama", model: "qwen2.5-coder:7b", reachable: true })),
    });
    const router = new ModelRouterService([ollama]);

    await expect(router.health()).resolves.toEqual({
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      reachable: true,
    });
  });
});
