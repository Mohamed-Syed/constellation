import type { AuthMe, AuthUser, LoginResponse } from "./types";
import { API_BASE } from "./api-base";

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
      // credentials: "include" lets the httpOnly `constellation_token` cookie
      // set by the API be stored/reused by the browser (Platform hardening
      // v0.6). The token is ALSO in the response body, so nothing here depends
      // on the cookie — it's additive.
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.status === 503) {
      // Boot-without-DB invariant: login is reachable but
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

/**
 * `GET /api/auth/me`.
 *
 * With `token` (the original path): attaches `Authorization: Bearer <token>`.
 * Without `token` (Platform hardening v0.6 — cookie-only session restore):
 * sends the request with `credentials: "include"` and NO Authorization header,
 * so the globally-authenticating server reads the httpOnly `constellation_token`
 * cookie instead. Either way the caller needs no token readable by JS — the
 * httpOnly cookie closes the localStorage XSS-exposure for fresh sessions.
 */
export async function fetchMe(token?: string): Promise<MeOutcome> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: "include",
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
 *
 * The request is sent with `credentials: "include"` so a session held only
 * in the httpOnly `constellation_token` cookie is cleared server-side too.
 */
export async function logoutRequest(token?: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: "include",
    });
  } catch {
    // Ignore — logout proceeds client-side either way.
  }
}
