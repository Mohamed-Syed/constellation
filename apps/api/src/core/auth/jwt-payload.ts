/**
 * Claims embedded in the platform's locally-issued JWT (signed in
 * `AuthService.login`). Roles + the flattened permission set are baked in at
 * issue time so a request never needs a database round trip to authorize —
 * matching the "boot/serve with no DB" invariant once a token already
 * exists. A role change takes effect on the user's next login (stateless
 * tokens have no server-side revocation in this phase).
 */
export interface JwtPayload {
  /** Subject — the user id. */
  sub: string;
  email: string;
  roles: string[];
  permissions: string[];
}
