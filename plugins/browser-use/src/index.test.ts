import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@constellation/plugin-sdk";
import plugin, {
  __setFetchForTests,
  __setSleepForTests,
  buildTaskRequest,
  resolveApiKey,
  resolveBaseUrl,
  type HttpRequestInit,
  type HttpResponse,
} from "./index.js";

/**
 * Unit tests for the browser-use adapter. NO REAL NETWORK: every test injects a
 * fake fetch via `__setFetchForTests`, and `__setSleepForTests` makes the task
 * polling loop instant so nothing sleeps on a real timer.
 *
 * These assert against the REAL browser-use wire protocol (async task create +
 * poll), which is what P4 corrected — the round-2 version targeted invented
 * `/api/v1/navigate` style routes that don't exist upstream.
 */

const BASE = "https://bu.test";
const KEY = "bu-test-key";

/** Minimal PluginContext; settings come from the map, env is used as fallback. */
function makeCtx(settings: Record<string, unknown> = {}): PluginContext {
  return {
    pluginId: "browser-use",
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as never,
    config: {
      get: <T>(key: string) => settings[key] as T | undefined,
      getOrThrow: <T>(key: string) => settings[key] as T,
      isFeatureEnabled: () => false,
    },
    events: { emit: vi.fn(), on: vi.fn(), onPlatform: vi.fn() },
    getPrincipal: () => undefined,
  } as unknown as PluginContext;
}

const configured = () => makeCtx({ baseUrl: BASE, apiKey: KEY, pollIntervalMs: 1 });

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

/** Nth recorded call, asserted present — keeps strict index checks happy. */
function callAt(calls: Call[], i: number): Call {
  const c = calls[i];
  if (!c) throw new Error(`expected a fetch call at index ${i}, got ${calls.length}`);
  return c;
}

/** Records calls and replies from a queue of handlers. */
function fakeFetch(handlers: ((call: Call, n: number) => HttpResponse)[]) {
  const calls: Call[] = [];
  let n = 0;
  const fn = async (url: string, init?: HttpRequestInit): Promise<HttpResponse> => {
    const call = { url, init };
    calls.push(call);
    const handler = handlers[Math.min(n, handlers.length - 1)]!;
    n += 1;
    return handler(call, n - 1);
  };
  __setFetchForTests(fn);
  return calls;
}

beforeEach(() => {
  delete process.env.BROWSER_USE_URL;
  delete process.env.BROWSER_USE_API_KEY;
  delete process.env.BROWSER_USE_BACKEND;
  __setSleepForTests(async () => {}); // no real waiting
});

afterEach(() => {
  __setFetchForTests(undefined);
  __setSleepForTests(undefined);
  vi.restoreAllMocks();
});

describe("configuration", () => {
  it("defaults to the hosted cloud when nothing is set", () => {
    expect(resolveBaseUrl(makeCtx())).toBe("https://api.browser-use.com");
  });

  it("prefers the baseUrl setting over the env var, and strips trailing slashes", () => {
    process.env.BROWSER_USE_URL = "https://env.example.com";
    expect(resolveBaseUrl(makeCtx({ baseUrl: "https://setting.example.com///" }))).toBe(
      "https://setting.example.com",
    );
  });

  it("falls back to BROWSER_USE_URL when no setting is present", () => {
    process.env.BROWSER_USE_URL = "https://env.example.com/";
    expect(resolveBaseUrl(makeCtx())).toBe("https://env.example.com");
  });

  it("reads the api key from settings, then env; undefined when unset", () => {
    expect(resolveApiKey(makeCtx())).toBeUndefined();
    process.env.BROWSER_USE_API_KEY = "from-env";
    expect(resolveApiKey(makeCtx())).toBe("from-env");
    expect(resolveApiKey(makeCtx({ apiKey: "from-setting" }))).toBe("from-setting");
  });
});

describe("not configured", () => {
  it("returns an actionable error instead of throwing when no api key is set", async () => {
    const res = await plugin.invokeTool!("browser.act", { instruction: "click" }, makeCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/not configured/i);
      expect(res.error).toContain("BROWSER_USE_API_KEY");
    }
  });

  it("reports degraded (not down) health when unconfigured — the plugin itself is fine", async () => {
    const health = await plugin.health!(makeCtx());
    expect(health.status).toBe("degraded");
    expect(health.checks?.service).toBe("down");
  });

  it("makes NO network call when unconfigured", async () => {
    const calls = fakeFetch([() => jsonRes({})]);
    await plugin.invokeTool!("browser.navigate", { url: "https://x.test" }, makeCtx());
    expect(calls).toHaveLength(0);
  });
});

describe("argument validation (before any network call)", () => {
  it.each([
    ["browser.navigate", {}, /requires a non-empty string argument "url"/],
    ["browser.act", {}, /requires a non-empty string argument "instruction"/],
    ["browser.extract", { query: "   " }, /requires a non-empty string argument "query"/],
    ["browser.navigate", { url: "not-a-url" }, /absolute http\(s\) url/],
  ])("rejects %s with bad args", async (tool, args, expected) => {
    const calls = fakeFetch([() => jsonRes({})]);
    const res = await plugin.invokeTool!(tool, args as Record<string, unknown>, configured());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(expected);
    expect(calls).toHaveLength(0); // never hit the network
  });

  it("rejects an undeclared tool name", async () => {
    const res = await plugin.invokeTool!("browser.teleport", {}, configured());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/does not implement tool "browser.teleport"/);
  });
});

describe("task request building", () => {
  it("navigate seeds startUrl and asks for confirmation", () => {
    const body = buildTaskRequest("browser.navigate", { url: "https://a.test" })!;
    expect(body.startUrl).toBe("https://a.test");
    expect(String(body.task)).toContain("https://a.test");
  });

  it("act passes the instruction through as the task", () => {
    const body = buildTaskRequest("browser.act", { instruction: "click Sign in" })!;
    expect(body.task).toBe("click Sign in");
  });

  it("extract asks for data only and forwards structuredOutput", () => {
    const body = buildTaskRequest("browser.extract", {
      query: "all prices",
      structuredOutput: '{"type":"object"}',
    })!;
    expect(String(body.task)).toContain("all prices");
    expect(body.structuredOutput).toBe('{"type":"object"}');
  });
});

describe("real task protocol: create then poll", () => {
  it("POSTs /api/v2/tasks with the api key header, then polls until finishedAt", async () => {
    const calls = fakeFetch([
      () => jsonRes({ id: "task-1", sessionId: "sess-1" }, 202), // create
      () => jsonRes({ id: "task-1", finishedAt: null }), // still running
      () =>
        jsonRes({
          id: "task-1",
          sessionId: "sess-1",
          finishedAt: "2026-01-01T00:00:00Z",
          isSuccess: true,
          output: "Example Domain",
          steps: [{ number: 1 }, { number: 2 }],
        }),
    ]);

    const res = await plugin.invokeTool!(
      "browser.navigate",
      { url: "https://example.com" },
      configured(),
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toMatchObject({
        taskId: "task-1",
        output: "Example Domain",
        steps: 2,
        sessionId: "sess-1",
      });
    }

    // Create call: correct URL, method, auth header, and body.
    expect(callAt(calls, 0).url).toBe(`${BASE}/api/v2/tasks`);
    expect(callAt(calls, 0).init?.method).toBe("POST");
    expect(callAt(calls, 0).init?.headers?.["X-Browser-Use-API-Key"]).toBe(KEY);
    expect(JSON.parse(callAt(calls, 0).init!.body!).startUrl).toBe("https://example.com");

    // Poll calls: GET the task by id.
    expect(callAt(calls, 1).url).toBe(`${BASE}/api/v2/tasks/task-1`);
    expect(callAt(calls, 1).init?.method).toBe("GET");
    expect(calls).toHaveLength(3);
  });

  it("surfaces a create failure with the upstream status and body", async () => {
    fakeFetch([() => ({ ok: false, status: 429, json: async () => ({}), text: async () => "rate limited" })]);
    const res = await plugin.invokeTool!("browser.act", { instruction: "go" }, configured());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("429");
      expect(res.error).toContain("rate limited");
    }
  });

  it("errors when the service returns no task id", async () => {
    fakeFetch([() => jsonRes({ sessionId: "s" }, 202)]);
    const res = await plugin.invokeTool!("browser.act", { instruction: "go" }, configured());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/did not return a task id/);
  });

  it("reports an unsuccessful task as ok:false with its output", async () => {
    fakeFetch([
      () => jsonRes({ id: "t2" }, 202),
      () => jsonRes({ id: "t2", finishedAt: "2026-01-01T00:00:00Z", isSuccess: false, output: "blocked by captcha" }),
    ]);
    const res = await plugin.invokeTool!("browser.extract", { query: "prices" }, configured());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("blocked by captcha");
  });

  it("retries transient poll failures instead of giving up", async () => {
    let polls = 0;
    fakeFetch([
      () => jsonRes({ id: "t3" }, 202),
      () => {
        polls += 1;
        if (polls === 1) throw new Error("ECONNRESET");
        if (polls === 2) return { ok: false, status: 502, json: async () => ({}), text: async () => "bad gateway" };
        return jsonRes({ id: "t3", finishedAt: "2026-01-01T00:00:00Z", isSuccess: true, output: "done" });
      },
    ]);
    const res = await plugin.invokeTool!("browser.act", { instruction: "go" }, configured());
    expect(res.ok).toBe(true);
    expect(polls).toBe(3);
  });

  it("gives up with a timeout error once the budget is exhausted", async () => {
    fakeFetch([
      () => jsonRes({ id: "t4" }, 202),
      () => jsonRes({ id: "t4", finishedAt: null }), // never finishes
    ]);
    const ctx = makeCtx({ baseUrl: BASE, apiKey: KEY, timeoutMs: 5, pollIntervalMs: 1 });
    __setSleepForTests(async () => {
      await new Promise((r) => setTimeout(r, 3)); // burn the tiny budget
    });
    const res = await plugin.invokeTool!("browser.act", { instruction: "go" }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/did not finish within/);
  });

  it("never throws — a hard network error becomes an ok:false envelope", async () => {
    fakeFetch([
      () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
    ]);
    const res = await plugin.invokeTool!("browser.act", { instruction: "go" }, configured());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("ENOTFOUND");
  });
});

describe("health against a configured service", () => {
  it("is ok when the authenticated probe succeeds", async () => {
    const calls = fakeFetch([() => jsonRes({ id: "user-1" })]);
    const health = await plugin.health!(configured());
    expect(health.status).toBe("ok");
    expect(callAt(calls, 0).url).toBe(`${BASE}/api/v2/me`);
    expect(callAt(calls, 0).init?.headers?.["X-Browser-Use-API-Key"]).toBe(KEY);
  });

  it("calls out a rejected api key specifically", async () => {
    fakeFetch([() => ({ ok: false, status: 401, json: async () => ({}), text: async () => "" })]);
    const health = await plugin.health!(configured());
    expect(health.status).toBe("down");
    expect(health.detail).toMatch(/rejected the configured API key/);
  });

  it("is down (not throwing) when the service is unreachable", async () => {
    fakeFetch([
      () => {
        throw new Error("ECONNREFUSED");
      },
    ]);
    const health = await plugin.health!(configured());
    expect(health.status).toBe("down");
    expect(health.detail).toContain("ECONNREFUSED");
  });
});
