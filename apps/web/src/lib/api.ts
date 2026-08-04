import type { PlatformHealth, PluginDetail, PluginSummary } from "./types";
import { API_BASE } from "./api-base";

// Note: intentionally not importing the `server-only` package — it isn't in
// this workspace's installed dependencies. This module is only ever called
// from Server Components (see apps/web/src/app/**), so it's safe without it.

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

// ── Phase 3.0 — PLUGIN MARKETPLACE ───────────────────────────────────────────

/** One bundled-but-not-installed catalog entry (GET /api/plugins/catalog). */
export interface CatalogAvailablePlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  toolCount: number;
}

/** `GET /api/plugins/catalog` — installed plugins + the marketplace shelf. */
export interface PluginCatalog {
  installed: PluginSummary[];
  available: CatalogAvailablePlugin[];
}

/** Fetch the marketplace catalog. `null` when the API is unreachable. */
export async function getPluginCatalog(token?: string): Promise<PluginCatalog | null> {
  try {
    const res = await fetch(`${API_BASE}/plugins/catalog`, {
      cache: "no-store",
      headers: authHeaders(token),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { installed?: unknown; available?: unknown };
    return {
      installed: Array.isArray(data.installed) ? (data.installed as PluginSummary[]) : [],
      available: Array.isArray(data.available) ? (data.available as CatalogAvailablePlugin[]) : [],
    };
  } catch {
    return null;
  }
}

/** `POST /api/plugins/:id/install` — copy the catalog bundle into plugins/. */
export type InstallCatalogOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "unauthenticated" | "forbidden" | "unreachable" | "error"; message: string };

export async function installCatalogPlugin(id: string, token?: string): Promise<InstallCatalogOutcome> {
  if (!token) return { ok: false, reason: "unauthenticated", message: "You must be signed in to install plugins." };
  try {
    const res = await fetch(`${API_BASE}/plugins/${encodeURIComponent(id)}/install`, {
      method: "POST",
      headers: authHeaders(token),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "forbidden", message: "You need the plugin-manage permission to install plugins." };
    }
    if (!res.ok) return { ok: false, reason: "error", message: `Install failed (HTTP ${res.status}).` };
    return { ok: true, id };
  } catch {
    return { ok: false, reason: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/** `POST /api/plugins/:id/uninstall` — remove a catalog-installed plugin. */
export async function uninstallCatalogPlugin(id: string, token?: string): Promise<InstallCatalogOutcome> {
  if (!token) return { ok: false, reason: "unauthenticated", message: "You must be signed in to uninstall plugins." };
  try {
    const res = await fetch(`${API_BASE}/plugins/${encodeURIComponent(id)}/uninstall`, {
      method: "POST",
      headers: authHeaders(token),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "forbidden", message: "You need the plugin-manage permission to uninstall plugins." };
    }
    if (!res.ok) return { ok: false, reason: "error", message: `Uninstall failed (HTTP ${res.status}).` };
    return { ok: true, id };
  } catch {
    return { ok: false, reason: "unreachable", message: "Can't reach the Constellation API." };
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
