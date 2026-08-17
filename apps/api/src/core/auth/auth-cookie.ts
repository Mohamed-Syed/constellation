import type { Response } from "express";

/**
 * Shared, zero-dependency helpers for the httpOnly auth cookie (Platform
 * hardening v0.6). Setting/clearing the cookie is a pure `Set-Cookie` header
 * op (no parser needed); reading it back is a trivial manual parse of the
 * `Cookie` request header. We deliberately avoid adding the `cookie-parser`
 * dependency for two small operations.
 *
 * The access token is issued BOTH in the login response body (backward
 * compatible — existing bearer-token clients keep working) AND as this
 * httpOnly, SameSite cookie. Because the cookie is httpOnly, client JS can
 * never read the token from it, closing the localStorage XSS-exposure
 * documented in `apps/web/src/lib/auth-storage.ts`.
 *
 * CSRF note (recorded, NOT over-engineered this round): SameSite=Lax + the
 * `@Public()` login/logout routes being POSTs already stops the overwhelming
 * majority of cross-site request-forgery (Lax blocks cross-site sends of the
 * cookie on POST). SameSite=Lax does still send the cookie on top-level
 * same-site navigations, so any future state-changing route that reads the
 * token from the cookie should use a double-submit or an explicit CSRF token
 * (e.g. `X-CSRF-Token`). Until then the read paths (`GET /api/auth/me`, and
 * the global `JwtAuthGuard` falling back to the cookie) are safe, and the
 * write paths that matter (login/logout) are `@Public()` and never trusted
 * to the cookie alone — login re-issues credentials, logout is stateless.
 */
export const AUTH_COOKIE_NAME_DEFAULT = "constellation_token";

/** The configured cookie name (override via AUTH_COOKIE_NAME), or the default. */
export function authCookieName(): string {
  return (process.env.AUTH_COOKIE_NAME ?? AUTH_COOKIE_NAME_DEFAULT).trim() || AUTH_COOKIE_NAME_DEFAULT;
}

function isSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Same-site value: Lax (+ Secure in production) — see the CSRF note above. */
function sameSite(): "lax" | "none" {
  // If an operator deliberately sets NODE_ENV=production AND serves the API
  // over plain http (rare, but possible in an internal network), a SameSite
  // cookie is still sent; prefer Lax+Secure — never `none` without Secure,
  // which browsers reject outright.
  return "lax";
}

/**
 * Build the `Set-Cookie` header value that sets the auth cookie on `res`.
 * httpOnly + SameSite=Lax always; `Secure` only when NODE_ENV=production.
 */
export function setAuthCookie(res: Response, token: string): void {
  const secure = isSecure() ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${authCookieName()}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite()}${secure}`,
  );
}

/** Build the `Set-Cookie` header value that clears the auth cookie on `res`. */
export function clearAuthCookie(res: Response): void {
  const secure = isSecure() ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${authCookieName()}=; Path=/; HttpOnly; SameSite=${sameSite()}; Max-Age=0${secure}`,
  );
}

/**
 * Read the auth token from the `Cookie` request header (declarative/driver).
 * Returns `undefined` when the header is absent or the cookie isn't present.
 * Zero-dep: parses the `name=urlencodedValue` pairs manually. The value we
 * set was `encodeURIComponent`d, so a plain `decodeURIComponent` round-trips
 * it.
 */
export function readAuthCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const name = authCookieName();
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      const raw = part.slice(eq + 1).trim();
      if (!raw) return undefined;
      try {
        return decodeURIComponent(raw);
      } catch {
        // Malformed percent-encoding in the cookie value — treat as absent.
        return undefined;
      }
    }
  }
  return undefined;
}
