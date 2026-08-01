import {
  definePlugin,
  type HealthResult,
  type PluginContext,
  type ToolResult,
} from "@constellation/plugin-sdk";

/**
 * browser-use — the platform's first AGENT-PLANE capability plugin.
 *
 * It owns no UI and no database. Its entire job is to turn the three tools it
 * declares in `plugin.manifest.json` (`browser.navigate` / `browser.act` /
 * `browser.extract`) into HTTP calls against a running browser-use service,
 * and to fail *legibly* when that service isn't configured.
 *
 * Design notes:
 * - ZERO runtime dependencies. Uses Node 18+ global `fetch` and
 *   `AbortSignal.timeout`, so nothing is installed for this plugin.
 * - Configuration resolves settings-first, env-second:
 *   `ctx.config.get("baseUrl")` → `process.env.BROWSER_USE_URL`. Unset means
 *   the plugin still loads and stays healthy-but-degraded; only tool calls
 *   fail, with an actionable "not configured" message. A missing optional
 *   integration must never block platform boot.
 * - Every failure path returns `{ ok: false, error }` rather than throwing, per
 *   the SDK's `ToolResult` contract — a broken upstream is data for the agent,
 *   not a reason to mark this plugin unhealthy.
 */

/** Env var read when no `baseUrl` setting is present. */
const ENV_BASE_URL = "BROWSER_USE_URL";
const DEFAULT_TIMEOUT_MS = 60_000;

/** Maps each declared tool name to the service path it POSTs to. */
const TOOL_ROUTES: Record<string, string> = {
  "browser.navigate": "/api/v1/navigate",
  "browser.act": "/api/v1/act",
  "browser.extract": "/api/v1/extract",
};

/** Required string args per tool, validated before any network call. */
const REQUIRED_ARGS: Record<string, string> = {
  "browser.navigate": "url",
  "browser.act": "instruction",
  "browser.extract": "query",
};

/**
 * Minimal structural types for the bits of the fetch API this plugin uses.
 *
 * The workspace's `lib` is ES2022 with no DOM, and `@types/node` doesn't put a
 * usable `Response`/`RequestInit` in the global scope, so referencing those
 * globals resolves to the wrong (or an incomplete) declaration. Declaring the
 * tiny surface we actually touch keeps the plugin dependency-free AND
 * DOM-lib-free, and doubles as the contract test fakes implement.
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

/** Injectable for tests — swapped out so no unit test ever touches the network. */
type FetchLike = (input: string, init?: HttpRequestInit) => Promise<HttpResponse>;
let fetchImpl: FetchLike | undefined;

/** Test seam: override the HTTP client. Pass `undefined` to restore global fetch. */
export function __setFetchForTests(fn: FetchLike | undefined): void {
  fetchImpl = fn;
}

function http(): FetchLike {
  return fetchImpl ?? (globalThis.fetch as FetchLike);
}

/** Resolve the service base URL: plugin setting first, then env. Trailing slash stripped. */
export function resolveBaseUrl(ctx: PluginContext): string | undefined {
  const fromConfig = ctx.config.get<string>("baseUrl");
  const raw = (fromConfig && fromConfig.trim()) || process.env[ENV_BASE_URL]?.trim();
  return raw ? raw.replace(/\/+$/, "") : undefined;
}

function resolveTimeoutMs(ctx: PluginContext): number {
  const configured = ctx.config.get<number>("timeoutMs");
  return typeof configured === "number" && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

const notConfigured = (): ToolResult => ({
  ok: false,
  error:
    `browser-use is not configured: set the "baseUrl" plugin setting or the ${ENV_BASE_URL} ` +
    `environment variable to the URL of a running browser-use HTTP service.`,
});

function asMessage(err: unknown): string {
  if (err instanceof Error) {
    // AbortSignal.timeout surfaces as a TimeoutError DOMException.
    if (err.name === "TimeoutError" || err.name === "AbortError") return "request timed out";
    return err.message;
  }
  return String(err);
}

export default definePlugin({
  register(ctx: PluginContext): void {
    const baseUrl = resolveBaseUrl(ctx);
    if (baseUrl) {
      ctx.logger.info(`browser-use registered — service at ${baseUrl}`);
    } else {
      ctx.logger.warn(
        `browser-use registered but NOT configured — set the "baseUrl" setting or ${ENV_BASE_URL}. ` +
          `Its tools will return a "not configured" error until then.`,
      );
    }
  },

  enable(ctx: PluginContext): void {
    ctx.logger.info("browser-use enabled");
  },

  /**
   * Unconfigured is `degraded`, not `down`: the plugin itself is fine, it just
   * has nothing to talk to. `down` is reserved for a configured-but-unreachable
   * service, which is a real operational problem worth alerting on.
   */
  async health(ctx: PluginContext): Promise<HealthResult> {
    const baseUrl = resolveBaseUrl(ctx);
    if (!baseUrl) {
      return {
        status: "degraded",
        detail: `no browser-use service configured (set "baseUrl" or ${ENV_BASE_URL})`,
        checks: { service: "down" },
      };
    }
    try {
      const res = await http()(`${baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok
        ? { status: "ok", detail: `browser-use service reachable at ${baseUrl}`, checks: { service: "ok" } }
        : {
            status: "down",
            detail: `browser-use service at ${baseUrl} returned HTTP ${res.status}`,
            checks: { service: "down" },
          };
    } catch (err) {
      return {
        status: "down",
        detail: `browser-use service at ${baseUrl} unreachable: ${asMessage(err)}`,
        checks: { service: "down" },
      };
    }
  },

  async invokeTool(name: string, args: Record<string, unknown>, ctx: PluginContext): Promise<ToolResult> {
    const route = TOOL_ROUTES[name];
    if (!route) {
      return { ok: false, error: `browser-use does not implement tool "${name}"` };
    }

    // Validate our own args — the manifest's inputSchema is opaque to the core.
    const requiredArg = REQUIRED_ARGS[name];
    if (requiredArg) {
      const value = args[requiredArg];
      if (typeof value !== "string" || value.trim() === "") {
        return { ok: false, error: `"${name}" requires a non-empty string argument "${requiredArg}"` };
      }
      if (name === "browser.navigate" && !/^https?:\/\//i.test(value)) {
        return { ok: false, error: `"browser.navigate" requires an absolute http(s) url, got "${value}"` };
      }
    }

    const baseUrl = resolveBaseUrl(ctx);
    if (!baseUrl) return notConfigured();

    const url = `${baseUrl}${route}`;
    try {
      const res = await http()(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(resolveTimeoutMs(ctx)),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return {
          ok: false,
          error: `browser-use service returned HTTP ${res.status} for "${name}"${body ? `: ${body.slice(0, 500)}` : ""}`,
        };
      }

      const data: unknown = await res.json().catch(() => undefined);
      if (data === undefined) {
        return { ok: false, error: `browser-use service returned a non-JSON body for "${name}"` };
      }
      ctx.logger.debug(`browser-use tool "${name}" succeeded`);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: `browser-use call to "${name}" failed: ${asMessage(err)}` };
    }
  },
});
