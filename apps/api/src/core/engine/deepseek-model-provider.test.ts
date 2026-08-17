import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { DeepSeekModelProvider } from "./deepseek-model-provider.js";
import type { ChatMessage } from "./model-provider.js";

/**
 * DeepSeekModelProvider tests — the THIRD ModelProvider (2026-08-04 round).
 * Same discipline as the OpenRouter/Ollama provider tests: the only external
 * seam is global `fetch`, stubbed with `vi.stubGlobal` and restored after
 * each test — no test opens a socket.
 *
 * Contracts under test:
 *  1. `chat()` POSTs { model, messages, stream:false, thinking } to
 *     <base>/chat/completions with Bearer auth, and normalizes the
 *     OpenAI-style response into a ChatResponse (token usage AND the
 *     DERIVED dollar cost — DeepSeek returns no cost field; costUSD is
 *     computed from the documented list pricing, env-overridable).
 *  2. Thinking mode toggle: default body carries thinking disabled; enabled
 *     carries { type:"enabled" } (+ reasoning_effort when configured).
 *  3. Non-2xx → a wrapped, descriptive error (5xx transient / 4xx terminal,
 *     incl. 401/403 bad key); abort → a wrapped timeout error; network
 *     failure → transient.
 *  4. Unconfigured-safe: constructor never throws, `health()` never throws
 *     and reports the honest reason, `canHandleModel()` refuses everything
 *     when the key is unset.
 */

const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_BASE = "https://api.deepseek.com";
const TEST_KEY = "sk-test-only";

function makeConfig(overrides: Record<string, string> = {}) {
  return {
    get: vi.fn((key: string, fallback?: unknown) => {
      if (key in overrides) return overrides[key];
      return fallback;
    }),
  } as unknown as ConfigService;
}

function okResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
    text: vi.fn(async () => ""),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: (...args: unknown[]) => unknown): ReturnType<typeof vi.fn> {
  fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function deepSeekCompletion(overrides: Record<string, unknown> = {}) {
  return {
    choices: [{ message: { content: "Hello from DeepSeek!" } }],
    model: DEFAULT_MODEL,
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    ...overrides,
  };
}

const messages: ChatMessage[] = [{ role: "user", content: "Say hello" }];

describe("DeepSeekModelProvider — chat()", () => {
  it("POSTs to <base>/chat/completions with Bearer auth + body (model, messages, stream:false, thinking disabled by default)", async () => {
    stubFetch(async () => okResponse(deepSeekCompletion()));
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    const res = await svc.chat(messages);

    expect(res.content).toBe("Hello from DeepSeek!");
    expect(res.provider).toBe("deepseek");
    expect(res.durationMs).toBeGreaterThanOrEqual(0);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_BASE}/chat/completions`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: `Bearer ${TEST_KEY}`,
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: DEFAULT_MODEL,
      messages,
      stream: false,
      thinking: { type: "disabled" },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends thinking enabled + reasoning_effort when configured", async () => {
    stubFetch(async () => okResponse(deepSeekCompletion()));
    const svc = new DeepSeekModelProvider(
      makeConfig({ DEEPSEEK_API_KEY: TEST_KEY, DEEPSEEK_THINKING: "enabled", DEEPSEEK_REASONING_EFFORT: "low" }),
    );

    await svc.chat(messages);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "low",
    });
  });

  it("parses a successful response into a ChatResponse with token usage", async () => {
    stubFetch(async () => okResponse(deepSeekCompletion()));
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    const res = await svc.chat(messages);

    expect(res).toMatchObject({
      content: "Hello from DeepSeek!",
      model: DEFAULT_MODEL,
      provider: "deepseek",
      durationMs: expect.any(Number),
    });
    expect(res.usage).toMatchObject({ inputTokens: 12, outputTokens: 7, totalTokens: 19 });
    // derived cost: (12 × $0.14 + 7 × $0.28) / 1e6 = 3.64e-6
    expect(res.usage?.costUSD).toBeCloseTo(3.64e-6, 12);
  });

  it("derives costUSD from the documented list pricing (no cache hit)", async () => {
    stubFetch(async () =>
      okResponse(deepSeekCompletion({ usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })),
    );
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    const res = await svc.chat(messages);

    // flash list prices: input $0.14/MTok (miss), output $0.28/MTok
    // (100 × 0.14 + 50 × 0.28) / 1e6 = (14 + 14) / 1e6 = 2.8e-5
    expect(res.usage?.costUSD).toBeCloseTo(2.8e-5, 12);
  });

  it("credits cache-hit tokens at the cache-hit rate when the API reports them", async () => {
    stubFetch(async () =>
      okResponse(
        deepSeekCompletion({
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, prompt_cache_hit_tokens: 40 },
        }),
      ),
    );
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    const res = await svc.chat(messages);

    // 40 hit × $0.0028 + 60 miss × $0.14 + 50 × $0.28 → (0.112 + 8.4 + 14) / 1e6
    expect(res.usage?.costUSD).toBeCloseTo(2.2512e-5, 12);
  });

  it("honours env price overrides (DEEPSEEK_PRICE_*_PER_MT)", async () => {
    stubFetch(async () =>
      okResponse(deepSeekCompletion({ usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } })),
    );
    const svc = new DeepSeekModelProvider(
      makeConfig({
        DEEPSEEK_API_KEY: TEST_KEY,
        DEEPSEEK_PRICE_INPUT_PER_MT: "1.0",
        DEEPSEEK_PRICE_OUTPUT_PER_MT: "2.0",
      }),
    );

    const res = await svc.chat(messages);

    expect(res.usage?.costUSD).toBeCloseTo((100 * 1.0 + 100 * 2.0) / 1e6, 12);
  });

  it("leaves costUSD off when the response carries no usage", async () => {
    stubFetch(async () => okResponse(deepSeekCompletion({ usage: undefined })));
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    const res = await svc.chat(messages);

    expect(res.usage).toBeUndefined();
  });

  it("passes an explicit model override through", async () => {
    stubFetch(async () => okResponse(deepSeekCompletion({ model: "deepseek-v4-pro" })));
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    const res = await svc.chat(messages, "deepseek-v4-pro");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "deepseek-v4-pro" });
    expect(res.model).toBe("deepseek-v4-pro");
  });

  it("normalizes a 'deepseek:'-prefixed model hint to the bare id before the API call (compare-UI path)", async () => {
    stubFetch(async () => okResponse(deepSeekCompletion()));
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    // The compare / portal UI sends "deepseek:deepseek-v4-flash"; the provider
    // must strip the prefix so DeepSeek's API doesn't reject it as unknown.
    await svc.chat(messages, "deepseek:deepseek-v4-flash");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "deepseek-v4-flash" });
  });

  it("wraps a 5xx as a TRANSIENT error with a descriptive message", async () => {
    stubFetch(async () => okResponse({ error: "overloaded" }, 503));
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    const err = await svc.chat(messages).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as { message: string }).message).toMatch(/DeepSeek returned HTTP 503/);
    expect((err as { transient: boolean }).transient).toBe(true);
  });

  it("wraps a 401 bad key as a TERMINAL error", async () => {
    stubFetch(async () => okResponse({ error: "invalid api key" }, 401));
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: "sk-wrong" }));

    const err = await svc.chat(messages).catch((e: Error) => e);

    expect((err as { message: string }).message).toMatch(/DeepSeek returned HTTP 401/);
    expect((err as { transient: boolean }).transient).toBe(false);
  });

  it("wraps an unknown-model 404 as a TERMINAL error", async () => {
    stubFetch(async () => okResponse({ error: "Model Not Exist" }, 404));
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    const err = await svc.chat(messages, "deepseek-nope").catch((e: Error) => e);

    expect((err as { message: string }).message).toMatch(/DeepSeek returned HTTP 404/);
    expect((err as { transient: boolean }).transient).toBe(false);
  });

  it("wraps a network failure as a TRANSIENT error", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    const err = await svc.chat(messages).catch((e: Error) => e);

    expect((err as { message: string }).message).toMatch(/fetch failed/);
    expect((err as { transient: boolean }).transient).toBe(true);
  });

  it("aborts a slow call past MODEL_TIMEOUT_MS and reports a transient error", async () => {
    stubFetch((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          (err as { name: string }).name = "AbortError";
          reject(err);
        });
      });
    });
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY, MODEL_TIMEOUT_MS: "10" }));

    const err = await svc.chat(messages).catch((e: Error) => e);

    expect((err as { transient: boolean }).transient).toBe(true);
  });
});

describe("DeepSeekModelProvider — unconfigured safety (the $0/local invariant)", () => {
  it("constructor never throws with no key", () => {
    expect(() => new DeepSeekModelProvider(makeConfig())).not.toThrow();
  });

  it("health() reports the honest reason when the key is unset", async () => {
    const svc = new DeepSeekModelProvider(makeConfig());

    const health = await svc.health();

    expect(health).toEqual({
      provider: "deepseek",
      model: "",
      reachable: false,
      error: "DEEPSEEK_API_KEY is not set",
    });
  });

  it("health() is reachable by construction when the key is set (no paid probe)", async () => {
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    const health = await svc.health();

    expect(health).toEqual({ provider: "deepseek", model: DEFAULT_MODEL, reachable: true });
  });

  it("chat() throws a TERMINAL error instead of POSTing 'Bearer undefined'", async () => {
    const svc = new DeepSeekModelProvider(makeConfig());

    const err = await svc.chat(messages).catch((e: Error) => e);

    expect((err as { message: string }).message).toMatch(/DEEPSEEK_API_KEY is not set/);
    expect((err as { transient: boolean }).transient).toBe(false);
  });

  it("canHandleModel() refuses everything when the key is unset", () => {
    const svc = new DeepSeekModelProvider(makeConfig());

    expect(svc.canHandleModel()).toBe(false);
    expect(svc.canHandleModel("deepseek-v4-flash")).toBe(false);
    expect(svc.canHandleModel("openai/gpt-oss-120b")).toBe(false);
  });
});

describe("DeepSeekModelProvider — routing (canHandleModel)", () => {
  it("handles a no-model request when keyed (a router candidate)", () => {
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    expect(svc.canHandleModel()).toBe(true);
  });

  it("handles bare deepseek-* model ids and the deepseek: prefix", () => {
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    expect(svc.canHandleModel("deepseek-v4-flash")).toBe(true);
    expect(svc.canHandleModel("deepseek-v4-pro")).toBe(true);
    expect(svc.canHandleModel("deepseek:deepseek-v4-flash")).toBe(true);
  });

  it("refuses slash ids (OpenRouter territory) and unrelated models", () => {
    const svc = new DeepSeekModelProvider(makeConfig({ DEEPSEEK_API_KEY: TEST_KEY }));

    expect(svc.canHandleModel("openai/gpt-oss-120b")).toBe(false);
    expect(svc.canHandleModel("qwen2.5-coder:7b")).toBe(false);
  });
});
