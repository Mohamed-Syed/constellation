/**
 * The authenticated principal attached to `request.user` by `JwtAuthGuard`
 * and returned by `GET /api/auth/me`. Kept deliberately provider-agnostic —
 * nothing in this shape is specific to local JWT auth — so a future OIDC/SSO
 * login populates exactly the same shape.
 */
export interface AuthPrincipal {
  id: string;
  email: string;
  roles: string[];
  /** Flattened union of every held role's permissions (colon-scoped strings). */
  permissions: string[];
}

/**
 * Isolates "how do we turn a bearer token into an `AuthPrincipal`" from
 * `JwtAuthGuard` and every controller. Today the only implementation is
 * `LocalJwtVerifier` (HS256 via `@nestjs/jwt`, signed at login). Swapping in
 * OIDC/JWKS-based verification later (or trying several verifiers in order)
 * means providing a different implementation for the `TOKEN_VERIFIER`
 * injection token in `auth.module.ts` — the guard and controllers never
 * change.
 */
export interface TokenVerifier {
  /** Returns the principal for a valid token, or `null` if it's invalid/expired. */
  verify(token: string): Promise<AuthPrincipal | null>;
}

export const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");
