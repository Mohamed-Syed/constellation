import {
  definePlugin,
  type HealthResult,
  type PluginContext,
  type ToolResult,
} from "@constellation/plugin-sdk";

/**
 * browser-use — the platform's first AGENT-PLANE capability plugin.
 *
 * It owns no UI and no database. Its job is to turn the three tools it declares
 * in `plugin.manifest.json` (`browser.navigate` / `browser.act` /
 * `browser.extract`) into calls against a REAL browser-use service, and to fail
 * legibly when that service isn't configured.
 *
 * ## Wiring to the real service (corrected in P4)
 * The round-2 version POSTed to invented `/api/v1/navigate|act|extract` routes.
 * **No such endpoints exist.** The real browser-use API (both the hosted cloud
 * at `api.browser-use.com` and the community self-hosted servers) is
 * *task-oriented and asynchronous*:
 *
 *   1. `POST {base}/api/v2/tasks`  body `{ task, startUrl?, maxSteps?, … }`
 *      → `202 { id, sessionId }`
 *   2. `GET  {base}/api/v2/tasks/{id}` → `{ … , output, isSuccess, finishedAt, steps[] }`
 *      Poll until `finishedAt` is set.
 *
 * Auth is the `X-Browser-Use-API-Key` header. Upstream has NO official
 * self-hosted REST image (browser-use issue #658 is the open request), so
 * `baseUrl` is configurable to point at either the cloud or a compatible
 * self-hosted server.
 *
 * Because the wire protocol is a single "run this task" primitive, the three
 * declared tools are *prompt shapes* over that one primitive rather than three
 * distinct endpoints — `navigate` seeds `startUrl`, `extract` asks for data
 * back, `act` performs an instruction. That keeps a useful, well-typed tool
 * surface for the agent plane while staying honest about the real API.
 *
 * ## Design constraints
 * - ZERO runtime dependencies: Node 18+ global `fetch` + `AbortSignal.timeout`.
 * - Config resolves settings-first, env-second, so no secret is hardcoded.
 * - Every failure returns `{ ok: false, error }` rather than throwing, per the
 *   SDK's `ToolResult` contract — a broken upstream is data for the agent, not
 *   a reason to mark this plugin unhealthy.
 */

/**
 * ## P4: a second, GENUINELY-LOCAL backend dialect (`steel`)
 *
 * The task-API dialect above (`cloud`) requires a paid `api.browser-use.com`
 * key: upstream ships **no** self-hosted REST image (browser-use issue #658 is
 * still the open request for one). To satisfy the "$0 / runs locally in
 * Docker" constraint the plugin now speaks a SECOND dialect against
 * **Steel Browser** (`ghcr.io/steel-dev/steel-browser`, Apache-2.0, free,
 * fully local), which is the closest real open-source equivalent.
 *
 * Steel's REST API is SYNCHRONOUS rather than task-oriented:
 *   - `POST {base}/v1/scrape`   `{ url, format:["html","markdown"], delay? }`
 *   - `POST {base}/v1/sessions` `{ ... }` (session lifecycle)
 *   - `GET  {base}/v1/health`   liveness
 *
 * So `backend` selects the dialect:
 *   - `cloud` (default) → async browser-use task API, needs an API key
 *   - `steel`           → local Steel Browser, needs NO key
 *
 * Steel is a browser sandbox, not an LLM agent, so it has no natural-language
 * "act" primitive. `browser.act` is therefore **honestly unsupported** on the
 * steel dialect and returns a clear error naming the limitation rather than
 * pretending to have performed the action. `navigate` and `extract` map onto
 * `/v1/scrape` and do real work end-to-end.
 */

/** Env vars read when the corresponding plugin settings are absent. */
const ENV_BASE_URL = "BROWSER_USE_URL";
const ENV_API_KEY = "BROWSER_USE_API_KEY";
const ENV_BACKEND = "BROWSER_USE_BACKEND";

/** Which wire dialect to speak. */
export type Backend = "cloud" | "steel";

/** Backend: `backend` setting → env → `cloud`. Unknown values fall back to cloud. */
export function resolveBackend(ctx: PluginContext): Backend {
  const fromConfig = ctx.config.get<string>("backend");
  const raw = ((fromConfig && fromConfig.trim()) || process.env[ENV_BACKEND]?.trim() || "")
    .toLowerCase();
  return raw === "steel" ? "steel" : "cloud";
}

/** Public cloud default; overridden by the `baseUrl` setting or env for self-hosting. */
const CLOUD_BASE_URL = "https://api.browser-use.com";

/** Conventional local Steel Browser port (`docker run -p 3000:3000 …`). */
const STEEL_BASE_URL = "http://localhost:3000";

const DEFAULT_TASK_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const HEALTH_TIMEOUT_MS = 5_000;

/** Required string arg per tool, validated before any network call. */
const REQUIRED_ARGS: Record<string, string> = {
  "browser.navigate": "url",
  "browser.act": "instruction",
  "browser.extract": "query",
};

/**
 * Minimal structural types for the bits of the fetch API this plugin uses.
 *
 * The workspace `lib` is ES2022 with no DOM, and `@types/node` doesn't expose a
 * usable global `Response`/`RequestInit`, so referencing those resolves to the
 * wrong declaration. Declaring the tiny surface we touch keeps the plugin both
 * dependency-free AND DOM-lib-free, and doubles as the contract test fakes implement.
 */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

type FetchLike = (input: string, init?: HttpRequestInit) => Promise<HttpResponse>;
let fetchImpl: FetchLike | undefined;

/** Test seam: override the HTTP client. Pass `undefined` to restore global fetch. */
export function __setFetchForTests(fn: FetchLike | undefined): void {
  fetchImpl = fn;
}

/** Test seam: makes polling instant so tests never sleep on real timers. */
let sleepImpl: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function __setSleepForTests(fn: ((ms: number) => Promise<void>) | undefined): void {
  sleepImpl = fn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
}

function http(): FetchLike {
  return fetchImpl ?? (globalThis.fetch as FetchLike);
}

/**
 * Base URL: `baseUrl` setting → env → dialect default.
 *
 * The steel dialect has no hosted default — a local Steel container is the
 * whole point — so it falls back to the conventional local port.
 */
export function resolveBaseUrl(ctx: PluginContext): string {
  const fromConfig = ctx.config.get<string>("baseUrl");
  const raw = (fromConfig && fromConfig.trim()) || process.env[ENV_BASE_URL]?.trim();
  const fallback = resolveBackend(ctx) === "steel" ? STEEL_BASE_URL : CLOUD_BASE_URL;
  return (raw || fallback).replace(/\/+$/, "");
}

/** API key: `apiKey` setting → env. Undefined when unset. */
export function resolveApiKey(ctx: PluginContext): string | undefined {
  const fromConfig = ctx.config.get<string>("apiKey");
  const raw = (fromConfig && fromConfig.trim()) || process.env[ENV_API_KEY]?.trim();
  return raw || undefined;
}

function numberSetting(ctx: PluginContext, key: string, fallback: number): number {
  const v = ctx.config.get<number>(key);
  return typeof v === "number" && v > 0 ? v : fallback;
}

const notConfigured = (): ToolResult => ({
  ok: false,
  error:
    `browser-use is not configured: set the "apiKey" plugin setting or the ${ENV_API_KEY} ` +
    `environment variable. Point "baseUrl" (or ${ENV_BASE_URL}) at a self-hosted server ` +
    `to use something other than ${CLOUD_BASE_URL}.`,
});

function asMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "request timed out";
    return err.message;
  }
  return String(err);
}

/** Build the browser-use task prompt + options for one of our declared tools. */
export function buildTaskRequest(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const maxSteps = typeof args.maxSteps === "number" ? args.maxSteps : undefined;
  const base: Record<string, unknown> = {};
  if (maxSteps) base.maxSteps = maxSteps;
  if (typeof args.startUrl === "string") base.startUrl = args.startUrl;

  switch (name) {
    case "browser.navigate": {
      const url = String(args.url);
      return {
        ...base,
        task:
          `Open ${url} and confirm it loaded. Report the final URL and the page title.` +
          (typeof args.then === "string" ? ` Then: ${args.then}` : ""),
        startUrl: url,
      };
    }
    case "browser.act": {
      const instruction = String(args.instruction);
      return { ...base, task: instruction };
    }
    case "browser.extract": {
      const query = String(args.query);
      return {
        ...base,
        task: `Extract the following from the page and return ONLY that data: ${query}`,
        ...(typeof args.structuredOutput === "string"
          ? { structuredOutput: args.structuredOutput }
          : {}),
      };
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Steel Browser dialect (local, $0)
// ---------------------------------------------------------------------------

/** What Steel's `POST /v1/scrape` gives back, as much as we read. */
interface SteelScrapeResponse {
  content?: { html?: string; markdown?: string; readability?: { title?: string } };
  metadata?: { title?: string; statusCode?: number; urlSource?: string; description?: string };
  links?: unknown[];
}

/** Trim scraped text so a tool result never floods the agent's context. */
const MAX_EXTRACT_CHARS = 20_000;

/** Build the Steel `/v1/scrape` request body for a tool call. */
export function buildSteelScrapeRequest(
  name: string,
  args: Record<string, unknown>,
): { url: string; format: string[]; delay?: number } | undefined {
  const url =
    name === "browser.navigate"
      ? String(args.url)
      : typeof args.startUrl === "string"
        ? args.startUrl
        : undefined;
  if (!url) return undefined;
  const delay = typeof args.delay === "number" ? args.delay : undefined;
  return {
    url,
    format: name === "browser.navigate" ? ["html"] : ["markdown", "html"],
    ...(delay ? { delay } : {}),
  };
}

/**
 * Executes one tool against a local Steel Browser instance.
 *
 * Kept separate from the cloud path because the two protocols share nothing:
 * Steel is one synchronous POST, browser-use is create-then-poll.
 */
async function invokeSteel(
  name: string,
  args: Record<string, unknown>,
  ctx: PluginContext,
  baseUrl: string,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<ToolResult> {
  if (name === "browser.act") {
    return {
      ok: false,
      error:
        `"browser.act" is not supported by the "steel" backend: Steel Browser is a browser ` +
        `sandbox (CDP + scrape/screenshot/pdf), not an LLM agent, so it has no ` +
        `natural-language action primitive. Use the "cloud" backend for browser.act, or drive ` +
        `Steel over CDP directly.`,
    };
  }

  const body = buildSteelScrapeRequest(name, args);
  if (!body) {
    return {
      ok: false,
      error: `"${name}" on the "steel" backend requires a "startUrl" argument to scrape.`,
    };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  try {
    const res = await http()(`${baseUrl}/v1/scrape`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        error:
          `Steel Browser returned HTTP ${res.status} for "${name}"` +
          (detail ? `: ${detail.slice(0, 500)}` : ""),
      };
    }

    const payload = (await res.json().catch(() => undefined)) as SteelScrapeResponse | undefined;
    if (!payload) {
      return { ok: false, error: `Steel Browser returned an unreadable body for "${name}"` };
    }

    const title = payload.metadata?.title ?? payload.content?.readability?.title ?? null;
    const finalUrl = payload.metadata?.urlSource ?? body.url;

    if (name === "browser.navigate") {
      ctx.logger.debug(`browser-use/steel navigate -> ${finalUrl}`);
      return {
        ok: true,
        data: {
          backend: "steel",
          url: finalUrl,
          title,
          statusCode: payload.metadata?.statusCode ?? null,
          links: Array.isArray(payload.links) ? payload.links.length : 0,
        },
      };
    }

    // browser.extract — hand back the page text plus the query that asked for it.
    const text = payload.content?.markdown ?? payload.content?.html ?? "";
    ctx.logger.debug(`browser-use/steel extract -> ${text.length} chars from ${finalUrl}`);
    return {
      ok: true,
      data: {
        backend: "steel",
        url: finalUrl,
        title,
        query: String(args.query),
        content: text.slice(0, MAX_EXTRACT_CHARS),
        truncated: text.length > MAX_EXTRACT_CHARS,
      },
    };
  } catch (err) {
    return { ok: false, error: `Steel Browser call to "${name}" failed: ${asMessage(err)}` };
  }
}

/** Shape of the task record we care about from `GET /api/v2/tasks/{id}`. */
interface TaskRecord {
  id?: string;
  output?: string | null;
  isSuccess?: boolean | null;
  finishedAt?: string | null;
  steps?: unknown[];
  sessionId?: string;
}

export default definePlugin({
  register(ctx: PluginContext): void {
    const backend = resolveBackend(ctx);
    const baseUrl = resolveBaseUrl(ctx);
    if (backend === "steel" || resolveApiKey(ctx)) {
      ctx.logger.info(`browser-use registered — backend=${backend}, service at ${baseUrl}`);
    } else {
      ctx.logger.warn(
        `browser-use registered but NOT configured — set the "apiKey" setting or ${ENV_API_KEY}, ` +
          `or set backend="steel" (${ENV_BACKEND}) to use a local Steel Browser with no key. ` +
          `Its tools will return a "not configured" error until then.`,
      );
    }
  },

  enable(ctx: PluginContext): void {
    ctx.logger.info("browser-use enabled");
  },

  /**
   * Unconfigured is `degraded`, not `down`: the plugin itself is fine, it just
   * has no credentials. `down` is reserved for configured-but-unreachable,
   * which is a real operational problem worth alerting on.
   */
  async health(ctx: PluginContext): Promise<HealthResult> {
    const backend = resolveBackend(ctx);
    const apiKey = resolveApiKey(ctx);
    const baseUrl = resolveBaseUrl(ctx);

    // The steel dialect needs NO credentials — a reachable local container is
    // the whole configuration, so "no api key" is not degraded there.
    if (backend === "cloud" && !apiKey) {
      return {
        status: "degraded",
        detail: `no browser-use credentials configured (set "apiKey" or ${ENV_API_KEY})`,
        checks: { service: "down" },
      };
    }

    const probeUrl = backend === "steel" ? `${baseUrl}/v1/health` : `${baseUrl}/api/v2/me`;
    const probeHeaders: Record<string, string> = {};
    if (backend === "cloud" && apiKey) probeHeaders["X-Browser-Use-API-Key"] = apiKey;
    else if (apiKey) probeHeaders["x-api-key"] = apiKey;

    try {
      // A cheap read that also validates credentials where they apply.
      const res = await http()(probeUrl, {
        method: "GET",
        headers: probeHeaders,
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (res.ok) {
        return {
          status: "ok",
          detail: `browser-use (${backend}) reachable at ${baseUrl}`,
          checks: { service: "ok" },
        };
      }
      return {
        status: "down",
        detail:
          res.status === 401 || res.status === 403
            ? `browser-use (${backend}) rejected the configured API key (HTTP ${res.status})`
            : `browser-use (${backend}) at ${baseUrl} returned HTTP ${res.status}`,
        checks: { service: "down" },
      };
    } catch (err) {
      return {
        status: "down",
        detail: `browser-use (${backend}) at ${baseUrl} unreachable: ${asMessage(err)}`,
        checks: { service: "down" },
      };
    }
  },

  async invokeTool(
    name: string,
    args: Record<string, unknown>,
    ctx: PluginContext,
  ): Promise<ToolResult> {
    if (!(name in REQUIRED_ARGS)) {
      return { ok: false, error: `browser-use does not implement tool "${name}"` };
    }

    // Validate our own args — the manifest's inputSchema is opaque to the core.
    const requiredArg = REQUIRED_ARGS[name];
    if (!requiredArg) {
      return { ok: false, error: `browser-use does not implement tool "${name}"` };
    }
    const value = args[requiredArg];
    if (typeof value !== "string" || value.trim() === "") {
      return { ok: false, error: `"${name}" requires a non-empty string argument "${requiredArg}"` };
    }
    if (name === "browser.navigate" && !/^https?:\/\//i.test(value)) {
      return { ok: false, error: `"browser.navigate" requires an absolute http(s) url, got "${value}"` };
    }

    const backend = resolveBackend(ctx);
    const apiKey = resolveApiKey(ctx);
    const baseUrl = resolveBaseUrl(ctx);
    const overallTimeoutMs = numberSetting(ctx, "timeoutMs", DEFAULT_TASK_TIMEOUT_MS);

    // --- steel dialect: one synchronous call, no credentials required -------
    if (backend === "steel") {
      return invokeSteel(name, args, ctx, baseUrl, apiKey, Math.min(120_000, overallTimeoutMs));
    }

    if (!apiKey) return notConfigured();

    const body = buildTaskRequest(name, args);
    if (!body) return { ok: false, error: `browser-use could not build a task for "${name}"` };

    const headers = {
      "content-type": "application/json",
      "X-Browser-Use-API-Key": apiKey,
    };
    const pollIntervalMs = numberSetting(ctx, "pollIntervalMs", DEFAULT_POLL_INTERVAL_MS);
    const deadline = Date.now() + overallTimeoutMs;

    // --- 1. Create the task -------------------------------------------------
    let taskId: string;
    try {
      const res = await http()(`${baseUrl}/api/v2/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(30_000, overallTimeoutMs)),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return {
          ok: false,
          error:
            `browser-use returned HTTP ${res.status} creating a task for "${name}"` +
            (detail ? `: ${detail.slice(0, 500)}` : ""),
        };
      }
      const created = (await res.json().catch(() => undefined)) as { id?: string } | undefined;
      if (!created?.id) {
        return { ok: false, error: `browser-use did not return a task id for "${name}"` };
      }
      taskId = created.id;
    } catch (err) {
      return { ok: false, error: `browser-use call to "${name}" failed: ${asMessage(err)}` };
    }

    // --- 2. Poll until the task finishes ------------------------------------
    while (Date.now() < deadline) {
      await sleepImpl(pollIntervalMs);
      let task: TaskRecord | undefined;
      try {
        const res = await http()(`${baseUrl}/api/v2/tasks/${taskId}`, {
          method: "GET",
          headers: { "X-Browser-Use-API-Key": apiKey },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          // A transient poll failure shouldn't kill a running task; keep trying
          // until the overall deadline, then report.
          continue;
        }
        task = (await res.json().catch(() => undefined)) as TaskRecord | undefined;
      } catch {
        continue; // transient network blip — retry until the deadline
      }

      if (task?.finishedAt) {
        if (task.isSuccess === false) {
          return {
            ok: false,
            error: `browser-use task ${taskId} for "${name}" finished unsuccessfully${
              task.output ? `: ${String(task.output).slice(0, 500)}` : ""
            }`,
          };
        }
        ctx.logger.debug(`browser-use tool "${name}" completed (task ${taskId})`);
        return {
          ok: true,
          data: {
            taskId,
            output: task.output ?? null,
            steps: Array.isArray(task.steps) ? task.steps.length : 0,
            sessionId: task.sessionId,
          },
        };
      }
    }

    return {
      ok: false,
      error: `browser-use task ${taskId} for "${name}" did not finish within ${overallTimeoutMs}ms`,
    };
  },
});
