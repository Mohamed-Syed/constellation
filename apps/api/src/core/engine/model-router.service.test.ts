import { describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "./model-provider.js";
import { TokenBudget } from "./model-provider.js";
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
});
