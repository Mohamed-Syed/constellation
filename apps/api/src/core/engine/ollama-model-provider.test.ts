import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { OllamaModelProvider } from "./ollama-model-provider.js";
import type { ChatMessage } from "./model-provider.js";

/**
 * OllamaModelProvider tests — the first ModelProvider implementation.
 * The only external seam is global `fetch`, so each test stubs
 * `globalThis.fetch` with `vi.stubGlobal` and restores it after — no test
 * opens a socket.
 *
 * Contracts under test:
 *  1. `chat()` POSTs { model, messages, stream:false } to <base>/api/chat and
 *     normalizes the Ollama response into a ChatResponse (incl. token usage).
 *  2. Non-2xx → a wrapped, descriptive error; abort → a wrapped timeout error.
 *  3. `health()` maps HTTP 200 → reachable:true, anything else → reachable:false
 *     with an explanatory error.
 */

const DEFAULT_MODEL = "llama3.2";
const DEFAULT_BASE = "http://localhost:11434";

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

const messages: ChatMessage[] = [{ role: "user", content: "Say hello" }];

describe("OllamaModelProvider — chat()", () => {
  it("POSTs to <base>/api/chat and parses a successful response", async () => {
    stubFetch(async () => okResponse({ message: { content: "Hello!" }, model: "llama3.2" }));
    const svc = new OllamaModelProvider(makeConfig());

    const res = await svc.chat(messages);

    expect(res).toEqual({
      content: "Hello!",
      model: "llama3.2",
      provider: "ollama",
      durationMs: expect.any(Number),
    });
    expect(res.durationMs).toBeGreaterThanOrEqual(0);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_BASE}/api/chat`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      model: DEFAULT_MODEL,
      messages,
      stream: false,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses an explicit model override and falls back to it when the response omits model", async () => {
    stubFetch(async () => okResponse({ message: { content: "ok" } }));
    const svc = new OllamaModelProvider(makeConfig());

    const res = await svc.chat(messages, "qwen2.5");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).model).toBe("qwen2.5");
    expect(res.model).toBe("qwen2.5");
    expect(res.content).toBe("ok");
  });

  it("parses token usage from the non-stream response (budget-cap seam)", async () => {
    stubFetch(async () =>
      okResponse({
        message: { content: "hi" },
        prompt_eval_count: 12,
        eval_count: 7,
      }),
    );
    const svc = new OllamaModelProvider(makeConfig());

    const res = await svc.chat(messages);

    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 7, totalTokens: 19 });
  });

  it("omits usage when the response carries no token counts (best-effort ceiling)", async () => {
    stubFetch(async () => okResponse({ message: { content: "hi" } }));
    const svc = new OllamaModelProvider(makeConfig());

    const res = await svc.chat(messages);

    expect(res.usage).toBeUndefined();
  });

  it("honours OLLAMA_BASE_URL from config", async () => {
    stubFetch(async () => okResponse({ message: { content: "hi" } }));
    const svc = new OllamaModelProvider(makeConfig({ OLLAMA_BASE_URL: "http://ollama:11434" }));

    await svc.chat(messages);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://ollama:11434/api/chat");
  });

  it("wraps an HTTP error with status and a snippet of the body", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 500,
      json: vi.fn(async () => ({})),
      text: vi.fn(async () => "connection refused to model"),
    } as unknown as Response));
    const svc = new OllamaModelProvider(makeConfig());

    await expect(svc.chat(messages)).rejects.toThrow(/Model router error: Ollama returned HTTP 500: connection refused to model/);
  });

  it("classifies a 5xx as TRANSIENT (retryable) — Task 5", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 503,
      json: vi.fn(async () => ({})),
      text: vi.fn(async () => "model loading"),
    } as unknown as Response));
    const svc = new OllamaModelProvider(makeConfig());

    await expect(svc.chat(messages)).rejects.toMatchObject({ transient: true });
  });

  it("classifies a 4xx as TERMINAL (fails immediately, no retry) — Task 5", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 404,
      json: vi.fn(async () => ({})),
      text: vi.fn(async () => "model 'nope' not found"),
    } as unknown as Response));
    const svc = new OllamaModelProvider(makeConfig());

    await expect(svc.chat(messages)).rejects.toMatchObject({ transient: false });
  });

  it("classifies a network failure as TRANSIENT (retryable) — Task 5", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const svc = new OllamaModelProvider(makeConfig());

    await expect(svc.chat(messages)).rejects.toMatchObject({ transient: true });
  });

  it("wraps a network failure with the underlying message", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const svc = new OllamaModelProvider(makeConfig());

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
    const svc = new OllamaModelProvider(makeConfig({ MODEL_TIMEOUT_MS: "10" }));

    await expect(svc.chat(messages)).rejects.toThrow(/Model router error: .*aborted/i);
    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe("OllamaModelProvider — health()", () => {
  it("reports reachable:true on a 200 from /api/tags", async () => {
    stubFetch(async () => ({ ok: true } as unknown as Response));
    const svc = new OllamaModelProvider(makeConfig());

    await expect(svc.health()).resolves.toEqual({
      provider: "ollama",
      model: DEFAULT_MODEL,
      reachable: true,
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${DEFAULT_BASE}/api/tags`);
  });

  it("reports reachable:false when the tags endpoint answers non-2xx", async () => {
    stubFetch(async () => ({ ok: false } as unknown as Response));
    const svc = new OllamaModelProvider(makeConfig());

    await expect(svc.health()).resolves.toEqual({
      provider: "ollama",
      model: DEFAULT_MODEL,
      reachable: false,
    });
  });

  it("reports reachable:false with a descriptive error on a network failure", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const svc = new OllamaModelProvider(makeConfig({ OLLAMA_BASE_URL: "http://ollama:11434" }));

    await expect(svc.health()).resolves.toEqual({
      provider: "ollama",
      model: DEFAULT_MODEL,
      reachable: false,
      error: "Ollama unreachable at http://ollama:11434",
    });
  });
});
