import type { AuthMe, AuthUser, LoginResponse } from "./types";

// Same env var / default the rest of the portal uses (see lib/api.ts).
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

/**
 * Client-side fetch helpers for the auth endpoints (`POST /api/auth/login`,
 * `GET /api/auth/me`, `POST /api/auth/logout`). Unlike `lib/api.ts` these are
 * only ever called from client components (the token lives in the browser —
 * see `lib/auth-storage.ts`), but they follow the same "never throw, return
 * a discriminated result" shape so callers can render a sensible message
 * instead of crashing when the API is down.
 */

export type LoginOutcome =
  | { ok: true; accessToken: string; user: AuthUser }
  | {
      ok: false;
      reason: "invalid-credentials" | "unavailable" | "unreachable" | "unknown";
      message: string;
    };

/** `POST /api/auth/login`. Distinguishes bad credentials, a DB-less 503, and a fully unreachable API. */
export async function login(email: string, password: string): Promise<LoginOutcome> {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.status === 503) {
      // Boot-without-DB invariant (MASTER_PLAN §8): login is reachable but
      // there's no database yet, so there's nobody to authenticate against.
      return {
        ok: false,
        reason: "unavailable",
        message: "The platform isn't fully set up yet (no database configured). Try again later.",
      };
    }
    if (res.status === 401 || res.status === 400) {
      return { ok: false, reason: "invalid-credentials", message: "Invalid email or password." };
    }
    if (!res.ok) {
      return { ok: false, reason: "unknown", message: `Sign-in failed (HTTP ${res.status}).` };
    }

    const data = (await res.json()) as Partial<LoginResponse>;
    if (!data?.accessToken || !data?.user) {
      return { ok: false, reason: "unknown", message: "Unexpected response from the server." };
    }
    return { ok: true, accessToken: data.accessToken, user: data.user };
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message: "Can't reach the Constellation API. Make sure it's running and try again.",
    };
  }
}

export type MeOutcome =
  | { ok: true; me: AuthMe }
  | { ok: false; reason: "unauthorized" | "unreachable" | "unknown" };

/** `GET /api/auth/me`. */
export async function fetchMe(token: string): Promise<MeOutcome> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "unauthorized" };
    }
    if (!res.ok) {
      return { ok: false, reason: "unknown" };
    }
    const me = (await res.json()) as AuthMe;
    return { ok: true, me };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/**
 * `POST /api/auth/logout`. Best-effort: logout is stateless per the API
 * contract (the server has nothing to revoke), so the client always
 * discards its token regardless of whether this call succeeds — callers
 * should not await this before clearing local state.
 */
export async function logoutRequest(token: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Ignore — logout proceeds client-side either way.
  }
}
