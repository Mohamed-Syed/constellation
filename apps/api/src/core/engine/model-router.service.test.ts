import { describe, expect, it, vi } from "vitest";
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
