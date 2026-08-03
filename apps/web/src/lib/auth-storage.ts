/**
 * Access-token storage for the portal's client-side auth (Orion P2 task 4).
 *
 * Strategy: an in-memory variable is the source of truth for the current tab
 * (fastest, no serialization), backed by a `localStorage` fallback so a page
 * reload / new tab doesn't force a fresh login.
 *
 * ⚠️ XSS CAVEAT — HARDENED (Platform hardening v0.6): `localStorage` is
 * readable by any JavaScript that runs on this origin; a stored token there
 * could be exfiltrated by an XSS bug. Since v0.6, the API ALSO issues the
 * access token as an httpOnly, SameSite=Lax (`Secure` in production) cookie
 * on login, and the portal now prefers a cookie-only session (see `fetchMe()`
 * in `lib/auth-api.ts`): on a fresh login / reload the httpOnly cookie is the
 * session source and NO token is put in `localStorage` at all. This file
 * remains ONLY as a backward-compatible fast-path for sessions that still
 * carry a JS-visible token; the cookie is the hardened path going forward and
 * the token stored here is treated as a bearer credential either way.
 *
 * CSRF note: SameSite=Lax already blocks cross-site POSTs of the cookie; the
 * read paths that consume it (the global guard, `/api/auth/me`) are CSRF-safe.
 * A CSRF token (double-submit / nonce) is deliberately NOT added this
 * hardening round — logged as a future item in `docs/MASTER_PLAN.md`.
 */

const STORAGE_KEY = "constellation.accessToken";

let memoryToken: string | null = null;

/** Read the current token: in-memory first, falling back to `localStorage`. */
export function getStoredToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const fromStorage = window.localStorage.getItem(STORAGE_KEY);
    if (fromStorage) memoryToken = fromStorage;
    return fromStorage;
  } catch {
    // Storage unavailable (SSR, private mode, disabled by policy) — no
    // persisted session; the caller falls back to "logged out".
    return null;
  }
}

/** Persist a newly issued token to both the in-memory cache and `localStorage`. */
export function setStoredToken(token: string): void {
  memoryToken = token;
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Storage unavailable — the session still works for this tab via the
    // in-memory copy, it just won't survive a reload.
  }
}

/** Clear the token everywhere (logout, or a 401 from `/api/auth/me`). */
export function clearStoredToken(): void {
  memoryToken = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
