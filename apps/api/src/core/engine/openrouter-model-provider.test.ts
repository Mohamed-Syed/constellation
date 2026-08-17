import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { OpenRouterModelProvider } from "./openrouter-model-provider.js";
import type { ChatMessage } from "./model-provider.js";

/**
 * OpenRouterModelProvider tests — the second ModelProvider (Engine v0.3
 * Task 1). Same discipline as the Ollama provider tests: the only external
 * seam is global `fetch`, stubbed with `vi.stubGlobal` and restored after
 * each test — no test opens a socket.
 *
 * Contracts under test:
 *  1. `chat()` POSTs { model, messages, stream:false } to
 *     <base>/chat/completions with Bearer auth + attribution headers, and
 *     normalizes the OpenAI-style response into a ChatResponse (incl. token
 *     usage AND the dollar cost — the cost-aware budget seam).
 *  2. Non-2xx → a wrapped, descriptive error (5xx transient / 4xx terminal,
 *     incl. 401/403 bad key); abort → a wrapped timeout error; network
 *     failure → transient.
 *  3. Unconfigured-safe: constructor never throws, `health()` never throws
 *     and reports the honest reason, `canHandleModel()` refuses everything
 *     when the key is unset.
 */

const DEFAULT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_BASE = "https://openrouter.ai/api/v1";
const TEST_KEY = "sk-or-test-key";

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

function openRouterCompletion(overrides: Record<string, unknown> = {}) {
  return {
    choices: [{ message: { content: "Hello from OpenRouter!" } }],
    model: DEFAULT_MODEL,
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    ...overrides,
  };
}

const messages: ChatMessage[] = [{ role: "user", content: "Say hello" }];

describe("OpenRouterModelProvider — chat()", () => {
  it("POSTs to <base>/chat/completions with Bearer auth + body (model, messages, stream:false)", async () => {
    stubFetch(async () => okResponse(openRouterCompletion()));
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    const res = await svc.chat(messages);

    expect(res.content).toBe("Hello from OpenRouter!");
    expect(res.provider).toBe("openrouter");
    expect(res.durationMs).toBeGreaterThanOrEqual(0);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_BASE}/chat/completions`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: `Bearer ${TEST_KEY}`,
      "HTTP-Referer": "http://localhost:3005",
      "X-Title": "Constellation",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: DEFAULT_MODEL,
      messages,
      stream: false,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("parses a successful response into a ChatResponse with token usage", async () => {
    stubFetch(async () => okResponse(openRouterCompletion()));
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    const res = await svc.chat(messages);

    expect(res).toMatchObject({
      content: "Hello from OpenRouter!",
      model: DEFAULT_MODEL,
      provider: "openrouter",
      durationMs: expect.any(Number),
    });
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 7, totalTokens: 19 });
  });

  it("parses the dollar cost from usage.cost into usage.costUSD (cost-aware budget seam)", async () => {
    stubFetch(async () =>
      okResponse(openRouterCompletion({ usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.00123 } })),
    );
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    const res = await svc.chat(messages);

    expect(res.usage?.costUSD).toBeCloseTo(0.00123, 10);
  });

  it("derives costUSD from per-token pricing when usage.cost is absent", async () => {
    stubFetch(async () =>
      okResponse(
        openRouterCompletion({
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
            pricing: { prompt: "0.0000005", completion: "0.000002" },
          },
        }),
      ),
    );
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    const res = await svc.chat(messages);

    // 100 * 0.0000005 + 50 * 0.000002 = 0.00005 + 0.0001 = 0.00015
    expect(res.usage?.costUSD).toBeCloseTo(0.00015, 10);
  });

  it("omits costUSD when the response carries no pricing info", async () => {
    stubFetch(async () => okResponse(openRouterCompletion({ usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })));
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    const res = await svc.chat(messages);

    expect(res.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    expect(res.usage?.costUSD).toBeUndefined();
  });

  it("honours an explicit model override and falls back to it when the response omits model", async () => {
    stubFetch(async () => okResponse({ choices: [{ message: { content: "ok" } }] }));
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    const res = await svc.chat(messages, "qwen/qwen-2.5-72b");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).model).toBe("qwen/qwen-2.5-72b");
    expect(res.model).toBe("qwen/qwen-2.5-72b");
  });

  it("classifies a 5xx as TRANSIENT (retryable)", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 503,
      json: vi.fn(async () => ({})),
      text: vi.fn(async () => "overloaded"),
    } as unknown as Response));
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    await expect(svc.chat(messages)).rejects.toMatchObject({ transient: true });
  });

  it("classifies a 401/403 (bad key) as TERMINAL (fails immediately, no retry)", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 401,
      json: vi.fn(async () => ({})),
      text: vi.fn(async () => "invalid api key"),
    } as unknown as Response));
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: "sk-or-wrong" }));

    await expect(svc.chat(messages)).rejects.toMatchObject({ transient: false });
    await expect(svc.chat(messages)).rejects.toThrow(/HTTP 401/);
  });

  it("classifies any other 4xx as TERMINAL (unknown model / bad request)", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 404,
      json: vi.fn(async () => ({})),
      text: vi.fn(async () => "model not found"),
    } as unknown as Response));
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    await expect(svc.chat(messages)).rejects.toMatchObject({ transient: false });
  });

  it("classifies a network failure (TypeError) as TRANSIENT", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    await expect(svc.chat(messages)).rejects.toMatchObject({ transient: true });
    await expect(svc.chat(messages)).rejects.toThrow(/Model router error: fetch failed/);
  });

  it("aborts the request when the model timeout elapses", async () => {
    let capturedSignal: AbortSignal | undefined;
    stubFetch(
      (_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          capturedSignal = init.signal;
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError")),
          );
        }),
    );
    // 10ms timeout keeps the test fast while exercising the real timer + abort path.
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY, MODEL_TIMEOUT_MS: "10" }));

    await expect(svc.chat(messages)).rejects.toThrow(/Model router error: .*aborted/i);
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("refuses to call chat() without a key — terminal ModelCallError, never a doomed request", async () => {
    const fetchSpy = stubFetch(async () => okResponse({}));
    const svc = new OpenRouterModelProvider(makeConfig());

    await expect(svc.chat(messages)).rejects.toMatchObject({
      transient: false,
      message: expect.stringContaining("OPENROUTER_API_KEY is not set"),
    });
    expect(fetchSpy).not.toHaveBeenCalled(); // no network call was attempted
  });
});

describe("OpenRouterModelProvider — health()", () => {
  it("reports reachable:true with the default model when the key is set", async () => {
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    await expect(svc.health()).resolves.toEqual({
      provider: "openrouter",
      model: DEFAULT_MODEL,
      reachable: true,
    });
  });

  it("reports reachable:false with an honest reason when the key is an empty string", async () => {
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: "" }));

    await expect(svc.health()).resolves.toEqual({
      provider: "openrouter",
      model: "",
      reachable: false,
      error: "OPENROUTER_API_KEY is not set",
    });
  });

  it("reports reachable:false with an honest reason when the key is undefined", async () => {
    const svc = new OpenRouterModelProvider(makeConfig());

    await expect(svc.health()).resolves.toEqual({
      provider: "openrouter",
      model: "",
      reachable: false,
      error: "OPENROUTER_API_KEY is not set",
    });
  });

  it("never throws even with no key at all (boot must not crash)", async () => {
    const svc = new OpenRouterModelProvider(makeConfig());
    const result = await svc.health();
    expect(result.reachable).toBe(false);
    expect(result.error).toContain("OPENROUTER_API_KEY");
  });
});

describe("OpenRouterModelProvider — unconfigured safety", () => {
  it("constructor does NOT throw when OPENROUTER_API_KEY is unset", () => {
    expect(() => new OpenRouterModelProvider(makeConfig())).not.toThrow();
    expect(() => new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: "" }))).not.toThrow();
  });
});

describe("OpenRouterModelProvider — canHandleModel()", () => {
  it("returns true for a slash-style OpenRouter model id (openai/gpt-oss-120b)", () => {
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    expect(svc.canHandleModel("openai/gpt-oss-120b")).toBe(true);
  });

  it("returns true for an explicit openrouter: prefix", () => {
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    expect(svc.canHandleModel("openrouter:openai/gpt-oss-120b")).toBe(true);
  });

  it("returns false for a local-style model name without a slash (qwen2.5-coder:7b)", () => {
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    expect(svc.canHandleModel("qwen2.5-coder:7b")).toBe(false);
  });

  it("returns true for an undefined model (available) when the key is set", () => {
    const svc = new OpenRouterModelProvider(makeConfig({ OPENROUTER_API_KEY: TEST_KEY }));

    expect(svc.canHandleModel()).toBe(true);
  });

  it("returns false for EVERYTHING when the key is unset — the provider is never selected", () => {
    const svc = new OpenRouterModelProvider(makeConfig());

    expect(svc.canHandleModel("openai/gpt-oss-120b")).toBe(false);
    expect(svc.canHandleModel("openrouter:anything")).toBe(false);
    expect(svc.canHandleModel(undefined)).toBe(false);
  });
});
