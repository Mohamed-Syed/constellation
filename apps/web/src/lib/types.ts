/**
 * Local mirrors of the shapes `apps/api`'s read-only plugin endpoints return.
 *
 * The portal intentionally does NOT depend on `@constellation/plugin-sdk` at
 * build time (it isn't wired into this workspace package's dependencies yet —
 * see the O1 report for the ask). These types track
 * `packages/plugin-sdk/src/manifest.ts` (`NavItemSchema`) and
 * `apps/api/src/core/plugins/plugins.controller.ts`'s response shape by hand.
 * Keep them in sync if either changes.
 */

/** Matches `PluginState` in `packages/plugin-sdk/src/plugin.ts`. */
export type PluginState = "discovered" | "validated" | "registered" | "enabled" | "disabled" | "failed";

/** Matches `HealthResult` in `packages/plugin-sdk/src/plugin.ts`. */
export interface PluginHealth {
  status: "ok" | "degraded" | "down";
  detail?: string;
  checks?: Record<string, "ok" | "down">;
}

/** Matches `NavItemSchema` in `packages/plugin-sdk/src/manifest.ts`. */
export interface PluginNavItem {
  id: string;
  label: string;
  path: string;
  icon?: string;
  order: number;
  requiresPermissions: string[];
}

/** Shape returned by `GET /api/plugins` (`PluginsController.list`). */
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  state: PluginState;
  permissions: string[];
  navigation: PluginNavItem[];
  error?: string;
  /** From `PluginRegistryService.setHealth()` — `null` until the health poller's first pass completes. */
  health?: PluginHealth | null;
  /** ISO timestamp of the last health poll, or `null` before the first pass. */
  healthCheckedAt?: string | null;
  /** Agent-plane tool count; the full declarations live on the detail route. */
  toolCount?: number;
  /** Phase 3.0 — true when installed via the marketplace catalog (uninstallable). */
  catalogInstalled?: boolean;
}

/** A single declared agent-plane tool (C5). Mirrors `ToolSchema` in the Plugin SDK manifest. */
export interface PluginTool {
  name: string;
  description: string;
  /** JSON-Schema-shaped object describing the tool's arguments (opaque data to the core). */
  inputSchema: Record<string, unknown>;
  /** Permission the caller must hold to invoke this tool. */
  permission: string;
  /**
   * Manifest v2: when true, the engine's autonomous agent pauses the task for
   * human approval before this tool runs (POST /api/engine/tasks/:id/approve).
   */
  requiresApproval?: boolean;
}

/** A declared backend HTTP route the plugin exposes under `/api/plugins/<id>/...`. */
export interface PluginRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  requiresPermissions: string[];
  public: boolean;
}

/** A declared feature flag the plugin defines. */
export interface PluginFeatureFlag {
  key: string;
  description: string;
  default: boolean;
}

/** A declared settings field the plugin exposes in its Settings panel. */
export interface PluginSetting {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "secret" | "select" | "json";
  default?: unknown;
  options?: string[];
  description: string;
}

/** A declared background/scheduled job. */
export interface PluginJob {
  name: string;
  schedule?: string;
  description: string;
}

/**
 * Full shape returned by `GET /api/plugins/:id` (`PluginsController.get`).
 * The controller spreads the entire manifest, so this mirrors the SDK manifest
 * plus the runtime-overlaid fields. Track `packages/plugin-sdk/src/manifest.ts`
 * if the manifest grows; we keep this in sync by hand (the portal does not build
 * against the SDK to avoid coupling the workspace packages).
 */
export interface PluginDetail {
  manifestVersion: 2;
  // Identity
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  repository?: string;
  license: string;
  // Compatibility
  minPlatformVersion: string;
  dependencies: string[];
  requiredServices: ("database" | "redis" | "queue" | "storage" | "search" | "realtime")[];
  // Security
  permissions: string[];
  // Data
  databaseSchema?: string;
  databaseVersion?: string;
  // Contributions
  navigation: PluginNavItem[];
  routes: PluginRoute[];
  featureFlags: PluginFeatureFlag[];
  settings: PluginSetting[];
  jobs: PluginJob[];
  tools: PluginTool[];
  // Runtime
  entry: string;
  healthCheck: string;
  translations: string[];
  // Runtime-overlaid fields (not part of the manifest itself)
  state: PluginState;
  error?: string;
  health?: PluginHealth | null;
  healthCheckedAt?: string | null;
  /** True when the loaded runtime actually implements the invokeTool seam. */
  supportsToolInvocation: boolean;
}

/**
 * Auth shapes — mirror the "shared API contract (P2)" in
 * the platform design notes, hand-tracked for the same reason as the plugin
 * types above (the portal doesn't build against `apps/api` or the SDK).
 */

/** Basic identity embedded in the login response. */
export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
}

/** Shape returned by `POST /api/auth/login`. */
export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

/** Shape returned by `GET /api/auth/me` — identity plus the effective, flattened permission set. */
export interface AuthMe extends AuthUser {
  permissions: string[];
}

/** Shape returned by `GET /api/health` (`HealthController.health`). */
export interface PlatformHealth {
  status: "ok" | "degraded";
  platformVersion: string;
  uptimeSeconds: number;
  plugins: {
    total: number;
    failed: number;
    enabled: number;
    disabled: number;
    degradedOrDown: number;
    ids: { id: string; state: PluginState; health: PluginHealth["status"] | null }[];
  };
  timestamp: string;
}
