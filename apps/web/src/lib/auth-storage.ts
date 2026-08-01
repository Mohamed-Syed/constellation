/**
 * Access-token storage for the portal's client-side auth (Orion P2 task 4).
 *
 * Strategy: an in-memory variable is the source of truth for the current tab
 * (fastest, no serialization), backed by a `localStorage` fallback so a page
 * reload / new tab doesn't force a fresh login.
 *
 * ⚠️ XSS CAVEAT: `localStorage` is readable by any JavaScript that runs on
 * this origin. If this app is ever compromised by a cross-site-scripting
 * bug, an attacker's script can read this key and exfiltrate the token. This
 * is a deliberate, accepted tradeoff for now (there is no backend session
 * store / cookie support yet) — it is NOT safe against XSS by design.
 * Hardening to an httpOnly, SameSite cookie (so client JS can never touch
 * the token at all) is tracked as a later item — see `docs/MASTER_PLAN.md`
 * P2/P3 and does not block this round. Until then: keep this app free of
 * `dangerouslySetInnerHTML`/unsanitized third-party scripts, and treat the
 * token as a bearer credential with the same care as a password.
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
