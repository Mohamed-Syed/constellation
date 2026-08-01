import type { PlatformHealth, PluginDetail, PluginSummary } from "./types";

// Note: intentionally not importing the `server-only` package — it isn't in
// this workspace's installed dependencies. This module is only ever called
// from Server Components (see apps/web/src/app/**), so it's safe without it.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

/**
 * Optional bearer token support: these functions run from Server Components
 * (see apps/web/src/app/**) where the browser-only token in
 * `lib/auth-storage.ts` isn't reachable, so the SSR call sites below pass no
 * token — that's fine today because `GET /api/plugins*` isn't in the P2
 * guarded set (only auth, `enable`/`disable`, and `/api/audit` require a
 * Bearer per MASTER_PLAN §8's shared contract), and either way a 401 just
 * degrades to an empty list/`null` rather than throwing. Client components
 * (e.g. `lib/use-live.ts`) call these WITH a token from `useAuth()` so
 * live-polled data keeps working if these read routes ever get guarded too.
 */
function authHeaders(token?: string): HeadersInit | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

/**
 * Fetch every loaded plugin from the core. Degrades gracefully — an
 * unreachable/down API (or a fresh repo with no plugins) yields an empty
 * list rather than throwing, so the portal shell always renders.
 */
export async function getPlugins(token?: string): Promise<PluginSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/plugins`, { cache: "no-store", headers: authHeaders(token) });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as PluginSummary[]) : [];
  } catch {
    // API down / not started / wrong port — the caller renders an empty state.
    return [];
  }
}

/** Fetch a single plugin's full manifest + state, or `null` if unavailable. */
export async function getPlugin(id: string, token?: string): Promise<PluginSummary | null> {
  try {
    const res = await fetch(`${API_BASE}/plugins/${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: authHeaders(token),
    });
    if (!res.ok) return null;
    return (await res.json()) as PluginSummary;
  } catch {
    return null;
  }
}

/** Fetch a plugin's full detail (entire manifest + runtime state/health). `null` if not found. */
export async function getPluginDetail(id: string, token?: string): Promise<PluginDetail | null> {
  try {
    const res = await fetch(`${API_BASE}/plugins/${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: authHeaders(token),
    });
    if (!res.ok) return null;
    return (await res.json()) as PluginDetail;
  } catch {
    return null;
  }
}

/** Fetch the platform health summary, or `null` if the core is unreachable. */
export async function getHealth(): Promise<PlatformHealth | null> {
  try {
    const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PlatformHealth;
  } catch {
    return null;
  }
}
