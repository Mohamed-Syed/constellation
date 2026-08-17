import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@constellation/plugin-sdk";
import plugin, {
  __setFetchForTests,
  __setSleepForTests,
  buildSteelScrapeRequest,
  resolveBackend,
  resolveBaseUrl,
  type HttpRequestInit,
  type HttpResponse,
} from "./index.js";

/**
 * P4 LIVE WIRING — the `steel` backend dialect.
 *
 * These are separated from `index.test.ts` (which covers the async
 * browser-use *cloud* task API) because the two dialects share no wire shape:
 * cloud is create-then-poll, steel is a single synchronous POST.
 *
 * NO REAL NETWORK here — the transport is faked. But the response shapes
 * asserted below were copied from an ACTUAL `POST /v1/scrape` of
 * https://example.com against a real local container:
 *
 *   docker run -d -p 127.0.0.1:3010:3000 ghcr.io/steel-dev/steel-browser
 *
 * Steel Browser is Apache-2.0 and runs entirely locally, which is what makes
 * this backend $0. It is used because browser-use itself ships NO self-hosted
 * REST image (upstream issue #658 is the still-open request for one).
 */

const STEEL = "http://localhost:3010";

function makeCtx(settings: Record<string, unknown> = {}): PluginContext {
  return {
    pluginId: "browser-use",
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    } as never,
    config: {
      get: <T>(key: string) => settings[key] as T | undefined,
      getOrThrow: <T>(key: string) => settings[key] as T,
      isFeatureEnabled: () => false,
    },
    events: { emit: vi.fn(), on: vi.fn(), onPlatform: vi.fn() },
    getPrincipal: () => undefined,
  } as unknown as PluginContext;
}

const steelCtx = (extra: Record<string, unknown> = {}) =>
  makeCtx({ backend: "steel", baseUrl: STEEL, ...extra });

function jsonRes(body: unknown, status = 200): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

interface Call {
  url: string;
  init?: HttpRequestInit;
}

function callAt(calls: Call[], i: number): Call {
  const c = calls[i];
  if (!c) throw new Error(`expected a fetch call at index ${i}, got ${calls.length}`);
  return c;
}

function fakeFetch(handler: (call: Call, n: number) => HttpResponse) {
  const calls: Call[] = [];
  let n = 0;
  __setFetchForTests(async (url, init) => {
    calls.push({ url, init });
    return handler({ url, init }, n++);
  });
  return calls;
}

/** A real-shaped Steel `/v1/scrape` response body. */
const steelScrapeBody = {
  content: {
    html: "<html><body><h1>Example Domain</h1></body></html>",
    markdown: "This domain is for use in documentation examples.",
  },
  metadata: {
    statusCode: 200,
    title: "Example Domain",
    urlSource: "https://example.com/",
    wordCount: 17,
  },
  links: [{ url: "https://iana.org/domains/example" }],
};

beforeEach(() => {
  delete process.env.BROWSER_USE_URL;
  delete process.env.BROWSER_USE_API_KEY;
  delete process.env.BROWSER_USE_BACKEND;
  __setSleepForTests(async () => {});
});

afterEach(() => {
  __setFetchForTests(undefined);
  __setSleepForTests(undefined);
  vi.restoreAllMocks();
});

describe("steel: backend selection", () => {
  it("defaults to the cloud dialect", () => {
    expect(resolveBackend(makeCtx())).toBe("cloud");
  });

  it("selects steel from the setting", () => {
    expect(resolveBackend(makeCtx({ backend: "steel" }))).toBe("steel");
  });

  it("selects steel from BROWSER_USE_BACKEND, case-insensitively", () => {
    process.env.BROWSER_USE_BACKEND = "STEEL";
    expect(resolveBackend(makeCtx())).toBe("steel");
  });

  it("falls back to cloud for an unrecognised backend rather than failing", () => {
    expect(resolveBackend(makeCtx({ backend: "wat" }))).toBe("cloud");
  });

  it("uses the conventional local Steel port as the steel default base url", () => {
    expect(resolveBaseUrl(makeCtx({ backend: "steel" }))).toBe("http://localhost:3000");
  });

  it("still defaults to the hosted cloud for the cloud dialect", () => {
    expect(resolveBaseUrl(makeCtx())).toBe("https://api.browser-use.com");
  });
});

describe("steel: request shape", () => {
  it("scrapes html for navigate, seeded from `url`", () => {
    expect(buildSteelScrapeRequest("browser.navigate", { url: "https://example.com" })).toEqual({
      url: "https://example.com",
      format: ["html"],
    });
  });

  it("asks for markdown too on extract, seeded from `startUrl`", () => {
    expect(
      buildSteelScrapeRequest("browser.extract", {
        query: "the title",
        startUrl: "https://e.com",
      }),
    ).toEqual({ url: "https://e.com", format: ["markdown", "html"] });
  });

  it("passes an explicit delay through", () => {
    expect(
      buildSteelScrapeRequest("browser.navigate", { url: "https://e.com", delay: 500 }),
    ).toMatchObject({ delay: 500 });
  });

  it("has no url to scrape when extract omits startUrl", () => {
    expect(buildSteelScrapeRequest("browser.extract", { query: "x" })).toBeUndefined();
  });
});

describe("steel: end-to-end through invokeTool", () => {
  it("navigates with ONE synchronous POST to /v1/scrape and needs no api key", async () => {
    const calls = fakeFetch(() => jsonRes(steelScrapeBody));

    const out = await plugin.invokeTool!(
      "browser.navigate",
      { url: "https://example.com" },
      steelCtx(),
    );

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data).toMatchObject({
        backend: "steel",
        url: "https://example.com/",
        title: "Example Domain",
        statusCode: 200,
        links: 1,
      });
    }

    // No create+poll: exactly one round trip, unlike the cloud task API.
    expect(calls).toHaveLength(1);
    expect(callAt(calls, 0).url).toBe(`${STEEL}/v1/scrape`);
    expect(callAt(calls, 0).init?.method).toBe("POST");
    // Crucially: no credentials were required or sent.
    expect(callAt(calls, 0).init?.headers?.["x-api-key"]).toBeUndefined();
    expect(callAt(calls, 0).init?.headers?.["X-Browser-Use-API-Key"]).toBeUndefined();
  });

  it("returns page content for extract", async () => {
    fakeFetch(() => jsonRes(steelScrapeBody));
    const out = await plugin.invokeTool!(
      "browser.extract",
      { query: "the heading", startUrl: "https://example.com" },
      steelCtx(),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data).toMatchObject({
        backend: "steel",
        query: "the heading",
        content: "This domain is for use in documentation examples.",
        truncated: false,
      });
    }
  });

  it("sends x-api-key when one is configured", async () => {
    const calls = fakeFetch(() => jsonRes(steelScrapeBody));
    await plugin.invokeTool!(
      "browser.navigate",
      { url: "https://example.com" },
      steelCtx({ apiKey: "steel-key" }),
    );
    expect(callAt(calls, 0).init?.headers?.["x-api-key"]).toBe("steel-key");
  });

  it("refuses browser.act honestly instead of pretending it acted", async () => {
    let touched = false;
    __setFetchForTests(async () => {
      touched = true;
      throw new Error("should not be called");
    });

    const out = await plugin.invokeTool!(
      "browser.act",
      { instruction: "click sign in" },
      steelCtx(),
    );

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain('not supported by the "steel" backend');
      expect(out.error).toContain("browser sandbox");
    }
    expect(touched).toBe(false); // never hits the network for an unsupported op
  });

  it("explains that extract needs a startUrl on this backend", async () => {
    const out = await plugin.invokeTool!("browser.extract", { query: "x" }, steelCtx());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("startUrl");
  });

  it("still validates args before touching the backend", async () => {
    const out = await plugin.invokeTool!("browser.navigate", { url: "not-a-url" }, steelCtx());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("absolute http(s) url");
  });

  it("degrades honestly (no throw) when the local container is absent", async () => {
    __setFetchForTests(async () => {
      throw new Error("ECONNREFUSED");
    });
    const out = await plugin.invokeTool!(
      "browser.navigate",
      { url: "https://example.com" },
      steelCtx(),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("ECONNREFUSED");
  });

  it("surfaces an http error from Steel without throwing", async () => {
    fakeFetch(() => ({
      ok: false,
      status: 422,
      json: async () => ({}),
      text: async () => "bad url",
    }));
    const out = await plugin.invokeTool!(
      "browser.navigate",
      { url: "https://example.com" },
      steelCtx(),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain("HTTP 422");
      expect(out.error).toContain("bad url");
    }
  });

  it("truncates very large page content so a tool result cannot flood context", async () => {
    fakeFetch(() =>
      jsonRes({
        content: { markdown: "x".repeat(30_000) },
        metadata: { title: "big", urlSource: "https://big.test/" },
      }),
    );
    const out = await plugin.invokeTool!(
      "browser.extract",
      { query: "everything", startUrl: "https://big.test" },
      steelCtx(),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      const data = out.data as { content: string; truncated: boolean };
      expect(data.content).toHaveLength(20_000);
      expect(data.truncated).toBe(true);
    }
  });
});

describe("steel: health", () => {
  it("is ok when the local container answers /v1/health, with no api key", async () => {
    const calls = fakeFetch(() => jsonRes({ status: "ok" }));
    const health = await plugin.health!(steelCtx());
    expect(health.status).toBe("ok");
    expect(health.detail).toContain("steel");
    expect(callAt(calls, 0).url).toBe(`${STEEL}/v1/health`);
  });

  it("is down (not degraded) when the local container is absent", async () => {
    __setFetchForTests(async () => {
      throw new Error("ECONNREFUSED");
    });
    const health = await plugin.health!(steelCtx());
    expect(health.status).toBe("down");
    expect(health.detail).toContain("ECONNREFUSED");
  });

  it("keeps reporting degraded for an unconfigured CLOUD backend", async () => {
    const health = await plugin.health!(makeCtx());
    expect(health.status).toBe("degraded");
  });
});
