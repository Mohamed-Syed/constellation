/**
 * Core permission catalog + helpers.
 *
 * Permissions are colon-scoped strings: "<domain>:<resource>:<action>" or
 * "<domain>:<action>". The core owns the "core:*" and "platform:*" namespaces;
 * plugins define their own under their id, e.g. "billing:invoice:write".
 *
 * RBAC maps roles -> permissions; ABAC rules can further constrain at runtime.
 */

export const CorePermissions = {
  // Platform administration
  PLATFORM_ADMIN: "platform:admin",
  PLUGIN_MANAGE: "core:plugin:manage",
  USER_MANAGE: "core:user:manage",
  ROLE_MANAGE: "core:role:manage",
  SETTINGS_MANAGE: "core:settings:manage",
  AUDIT_READ: "core:audit:read",
  FEATURE_FLAG_MANAGE: "core:feature-flag:manage",
  // The brain (memory & knowledge graph) — see docs/BRAIN.md.
  // Added additively in SDK 0.2.0; no existing permission changed.
  BRAIN_READ: "core:brain:read",
  BRAIN_WRITE: "core:brain:write",
  // Phase 3.0 — visual workflow builder (CRUD + runs). `platform:admin` implies it.
  WORKFLOW_MANAGE: "core:workflow:manage",
  // Phase 4.0 4.6 — federated agent mesh (peer registry + topology). Ops surface.
  MESH_MANAGE: "core:mesh:manage",
  // Phase 5.0 — Agentic AI Controller. Reads ride on AUDIT_READ (the live
  // stability snapshot is an audit-surface read); RUNNING a recovery mutation
  // (re-enqueue dead letters, spawn diagnostics) needs this dedicated
  // permission so a read-only auditor can never mutate. `platform:admin` implies it.
  AI_CONTROLLER_MANAGE: "core:ai-controller:manage",
  // Baseline
  AUTHENTICATED: "core:authenticated",
} as const;

export type CorePermission = (typeof CorePermissions)[keyof typeof CorePermissions];

const PERMISSION_RE = /^[a-z0-9-]+(?::[a-z0-9-]+)+$/;

/** True if a permission string is well-formed. */
export function isValidPermission(p: string): boolean {
  return PERMISSION_RE.test(p);
}

/**
 * Does `held` satisfy `required`? Supports a trailing "*" wildcard segment,
 * e.g. holding "billing:*" satisfies "billing:invoice:write".
 */
export function permissionSatisfies(held: string, required: string): boolean {
  if (held === required) return true;
  if (held.endsWith(":*")) {
    const prefix = held.slice(0, -1); // keep trailing colon
    return required.startsWith(prefix);
  }
  if (held === "platform:admin") return true; // admin implies all
  return false;
}

/** True if ANY held permission satisfies the required one. */
export function hasPermission(held: readonly string[], required: string): boolean {
  return held.some((h) => permissionSatisfies(h, required));
}

/** True if the held set satisfies EVERY required permission. */
export function hasAllPermissions(held: readonly string[], required: readonly string[]): boolean {
  return required.every((r) => hasPermission(held, r));
}
