/**
 * Client-side permission matching for role-aware nav/UI gating.
 *
 * Hand-mirrors the algorithm in `packages/plugin-sdk/src/permissions.ts`
 * (`permissionSatisfies` / `hasPermission` / `hasAllPermissions`). The portal
 * intentionally does not depend on `@constellation/plugin-sdk` at build time
 * (see the note atop `lib/types.ts`), so this is kept in sync by hand — if
 * the SDK's matching rules change, update both.
 *
 * The actual authorization decision always happens server-side (RBAC guards
 * on `apps/api`); this only decides what the UI shows/hides for a good UX —
 * never treat a client-side pass here as a security boundary.
 */

/** Does `held` satisfy `required`? Supports a trailing "*" wildcard segment, and `platform:admin` implies everything. */
export function permissionSatisfies(held: string, required: string): boolean {
  if (held === required) return true;
  if (held.endsWith(":*")) {
    const prefix = held.slice(0, -1); // keep the trailing colon
    return required.startsWith(prefix);
  }
  if (held === "platform:admin") return true;
  return false;
}

/** True if ANY held permission satisfies the required one. */
export function hasPermission(held: readonly string[], required: string): boolean {
  return held.some((h) => permissionSatisfies(h, required));
}

/** True if the held set satisfies at least one of the required permissions. */
export function hasAnyPermission(held: readonly string[], required: readonly string[]): boolean {
  return required.some((r) => hasPermission(held, r));
}

/** True if the held set satisfies EVERY required permission. */
export function hasAllPermissions(held: readonly string[], required: readonly string[]): boolean {
  return required.every((r) => hasPermission(held, r));
}
