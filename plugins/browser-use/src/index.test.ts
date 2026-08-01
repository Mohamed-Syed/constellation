import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@constellation/plugin-sdk";
import plugin, { __setFetchForTests, resolveBaseUrl, type HttpResponse } from "./index.js";

/**
 * Fully offline: every test swaps in a fake fetch via `__setFetchForTests`, so
 * no real network call is ever made. The service contract exercised here is
 * "POST <baseUrl><route> with the args as JSON, expect JSON back".
 */

const BASE = "http://browser-use.test:8000";

function fakeContext(settings: Record<string, unknown> = {}): PluginContext {
  const logger: PluginContext["logger"] = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  };
  return {
    pluginId: "browser-use",
    logger,
    config: {
      get: <T>(key: string) => settings[key] as T | undefined,
      getOrThrow: <T>(key: string) => {
        if (!(key in settings)) throw new Error(`missing ${key}`);
        return settings[key] as T;
      },
      isFeatureEnabled: () => false,
    },
    events: { emit: () => undefined, on: () => undefined, onPlatform: () => undefined },
    getPrincipal: () => undefined,
  };
}

/** Minimal HttpResponse stand-in — the structural contract the runtime consumes. */
function jsonResponse(body: unknown, status = 200): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(body: string, status: number): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error("not json");
    },
    text: async () => body,
  };
}

afterEach(() => {
  __setFetchForTests(undefined);
  delete process.env.BROWSER_USE_URL;
});

describe("configuration resolution", () => {
  it("prefers the plugin setting over the env var", () => {
    process.env.BROWSER_USE_URL = "http://from-env";
    expect(resolveBaseUrl(fakeContext({ baseUrl: BASE }))).toBe(BASE);
  });

  it("falls back to BROWSER_USE_URL and strips trailing slashes", () => {
    process.env.BROWSER_USE_URL = `${BASE}///`;
    expect(resolveBaseUrl(fakeContext())).toBe(BASE);
  });

  it("returns undefined when neither is set (blank setting is not a URL)", () => {
    expect(resolveBaseUrl(fakeContext({ baseUrl: "   " }))).toBeUndefined();
  });
});

describe("lifecycle", () => {
  it("register() does not throw when unconfigured — a missing integration must not block boot", () => {
    expect(() => plugin.register?.(fakeContext())).not.toThrow();
  });

  it("register() does not throw when configured", () => {
    expect(() => plugin.register?.(fakeContext({ baseUrl: BASE }))).not.toThrow();
  });
});

describe("health()", () => {
  it("is degraded (not down) when no service is configured", async () => {
    const h = await plugin.health?.(fakeContext());
    expect(h?.status).toBe("degraded");
    expect(h?.checks).toEqual({ service: "down" });
  });

  it("is ok when the service health endpoint responds 200", async () => {
    __setFetchForTests(async (url) => {
      expect(url).toBe(`${BASE}/health`);
      return jsonResponse({ status: "ok" });
    });
    const h = await plugin.health?.(fakeContext({ baseUrl: BASE }));
    expect(h?.status).toBe("ok");
  });

  it("is down when the configured service is unreachable", async () => {
    __setFetchForTests(async () => {
      throw new Error("ECONNREFUSED");
    });
    const h = await plugin.health?.(fakeContext({ baseUrl: BASE }));
    expect(h?.status).toBe("down");
    expect(h?.detail).toContain("ECONNREFUSED");
  });

  it("is down when the service answers non-2xx", async () => {
    __setFetchForTests(async () => textResponse("boom", 503));
    const h = await plugin.health?.(fakeContext({ baseUrl: BASE }));
    expect(h?.status).toBe("down");
    expect(h?.detail).toContain("503");
  });
});

describe("invokeTool()", () => {
  it("rejects an unknown tool name", async () => {
    const r = await plugin.invokeTool?.("browser.teleport", {}, fakeContext({ baseUrl: BASE }));
    expect(r).toEqual({ ok: false, error: 'browser-use does not implement tool "browser.teleport"' });
  });

  it("returns an actionable error when unconfigured, without calling the network", async () => {
    const spy = vi.fn();
    __setFetchForTests(spy as never);
    const r = await plugin.invokeTool?.("browser.navigate", { url: "https://example.com" }, fakeContext());
    expect(r?.ok).toBe(false);
    expect(r).toMatchObject({ error: expect.stringContaining("BROWSER_USE_URL") });
    expect(spy).not.toHaveBeenCalled();
  });

  it("validates required args before any network call", async () => {
    const spy = vi.fn();
    __setFetchForTests(spy as never);
    const r = await plugin.invokeTool?.("browser.act", {}, fakeContext({ baseUrl: BASE }));
    expect(r).toEqual({
      ok: false,
      error: '"browser.act" requires a non-empty string argument "instruction"',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a non-absolute navigate url", async () => {
    const r = await plugin.invokeTool?.("browser.navigate", { url: "example.com" }, fakeContext({ baseUrl: BASE }));
    expect(r?.ok).toBe(false);
    expect(r).toMatchObject({ error: expect.stringContaining("absolute http(s) url") });
  });

  it("browser.navigate POSTs to /api/v1/navigate and returns the service payload", async () => {
    __setFetchForTests(async (url, init) => {
      expect(url).toBe(`${BASE}/api/v1/navigate`);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ url: "https://example.com" });
      return jsonResponse({ title: "Example Domain", url: "https://example.com" });
    });
    const r = await plugin.invokeTool?.(
      "browser.navigate",
      { url: "https://example.com" },
      fakeContext({ baseUrl: BASE }),
    );
    expect(r).toEqual({ ok: true, data: { title: "Example Domain", url: "https://example.com" } });
  });

  it("browser.act POSTs to /api/v1/act", async () => {
    __setFetchForTests(async (url) => {
      expect(url).toBe(`${BASE}/api/v1/act`);
      return jsonResponse({ done: true });
    });
    const r = await plugin.invokeTool?.(
      "browser.act",
      { instruction: "click Sign in" },
      fakeContext({ baseUrl: BASE }),
    );
    expect(r).toEqual({ ok: true, data: { done: true } });
  });

  it("browser.extract POSTs to /api/v1/extract", async () => {
    __setFetchForTests(async (url) => {
      expect(url).toBe(`${BASE}/api/v1/extract`);
      return jsonResponse({ items: ["a", "b"] });
    });
    const r = await plugin.invokeTool?.("browser.extract", { query: "all links" }, fakeContext({ baseUrl: BASE }));
    expect(r).toEqual({ ok: true, data: { items: ["a", "b"] } });
  });

  it("surfaces an upstream HTTP error as ok:false rather than throwing", async () => {
    __setFetchForTests(async () => textResponse("session expired", 500));
    const r = await plugin.invokeTool?.("browser.extract", { query: "x" }, fakeContext({ baseUrl: BASE }));
    expect(r?.ok).toBe(false);
    expect(r).toMatchObject({ error: expect.stringContaining("HTTP 500") });
    expect(r).toMatchObject({ error: expect.stringContaining("session expired") });
  });

  it("surfaces a transport failure as ok:false rather than throwing", async () => {
    __setFetchForTests(async () => {
      throw new Error("socket hang up");
    });
    const r = await plugin.invokeTool?.("browser.act", { instruction: "scroll" }, fakeContext({ baseUrl: BASE }));
    expect(r).toEqual({ ok: false, error: 'browser-use call to "browser.act" failed: socket hang up' });
  });

  it("reports a timeout in human terms", async () => {
    __setFetchForTests(async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    });
    const r = await plugin.invokeTool?.(
      "browser.navigate",
      { url: "https://slow.test" },
      fakeContext({ baseUrl: BASE }),
    );
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("request timed out") });
  });
});
