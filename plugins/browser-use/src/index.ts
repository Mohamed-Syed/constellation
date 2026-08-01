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

/** Env vars read when the corresponding plugin settings are absent. */
const ENV_BASE_URL = "BROWSER_USE_URL";
const ENV_API_KEY = "BROWSER_USE_API_KEY";

/** Public cloud default; overridden by the `baseUrl` setting or env for self-hosting. */
const CLOUD_BASE_URL = "https://api.browser-use.com";

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

/** Base URL: `baseUrl` setting → env → hosted cloud. Trailing slashes stripped. */
export function resolveBaseUrl(ctx: PluginContext): string {
  const fromConfig = ctx.config.get<string>("baseUrl");
  const raw = (fromConfig && fromConfig.trim()) || process.env[ENV_BASE_URL]?.trim();
  return (raw || CLOUD_BASE_URL).replace(/\/+$/, "");
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
    const baseUrl = resolveBaseUrl(ctx);
    if (resolveApiKey(ctx)) {
      ctx.logger.info(`browser-use registered — service at ${baseUrl}`);
    } else {
      ctx.logger.warn(
        `browser-use registered but NOT configured — set the "apiKey" setting or ${ENV_API_KEY}. ` +
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
    const apiKey = resolveApiKey(ctx);
    const baseUrl = resolveBaseUrl(ctx);
    if (!apiKey) {
      return {
        status: "degraded",
        detail: `no browser-use credentials configured (set "apiKey" or ${ENV_API_KEY})`,
        checks: { service: "down" },
      };
    }
    try {
      // A cheap authenticated read; also validates the key.
      const res = await http()(`${baseUrl}/api/v2/me`, {
        method: "GET",
        headers: { "X-Browser-Use-API-Key": apiKey },
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (res.ok) {
        return { status: "ok", detail: `browser-use reachable at ${baseUrl}`, checks: { service: "ok" } };
      }
      return {
        status: "down",
        detail:
          res.status === 401 || res.status === 403
            ? `browser-use rejected the configured API key (HTTP ${res.status})`
            : `browser-use at ${baseUrl} returned HTTP ${res.status}`,
        checks: { service: "down" },
      };
    } catch (err) {
      return {
        status: "down",
        detail: `browser-use at ${baseUrl} unreachable: ${asMessage(err)}`,
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

    const apiKey = resolveApiKey(ctx);
    if (!apiKey) return notConfigured();

    const baseUrl = resolveBaseUrl(ctx);
    const body = buildTaskRequest(name, args);
    if (!body) return { ok: false, error: `browser-use could not build a task for "${name}"` };

    const headers = {
      "content-type": "application/json",
      "X-Browser-Use-API-Key": apiKey,
    };
    const overallTimeoutMs = numberSetting(ctx, "timeoutMs", DEFAULT_TASK_TIMEOUT_MS);
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
