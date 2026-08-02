/**
 * Plugin Manifest — the declarative contract a plugin ships in
 * `plugin.manifest.json`. The core platform reads ONLY this to decide how to
 * mount, secure, route, and observe a plugin. No core code changes when a new
 * plugin is added; everything the core needs to know is declared here.
 *
 * Design rule: the manifest is data, never code. It is validated with Zod at
 * load time, so a malformed plugin is rejected loudly instead of half-loading.
 */
import { z } from "zod";

/** Semantic-version-ish string (loose; full semver validated by the loader). */
const versionString = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:[-+].+)?$/, "must be a semver-like version (e.g. 1.2.3)");

/** A plugin id: lowercase, url/dns/schema-safe. Also used as its DB schema name. */
const pluginId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,62}$/, "id must be kebab-case, start with a letter, 2-63 chars");

/** A permission this plugin requires, e.g. "core:read", "billing:invoice:write". */
const permission = z.string().regex(/^[a-z0-9-]+(?::[a-z0-9-]+)+$/, "permission must be colon-scoped");

/** A navigation entry the plugin contributes to the portal sidebar. */
export const NavItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Portal route the item links to (relative to the plugin's route mount). */
  path: z.string().startsWith("/"),
  /** Lucide icon name, resolved by the portal. */
  icon: z.string().optional(),
  /** Lower sorts first. */
  order: z.number().int().default(100),
  /** Only shown if the current user holds ALL of these permissions. */
  requiresPermissions: z.array(permission).default([]),
});
export type NavItem = z.infer<typeof NavItemSchema>;

/** An HTTP route the plugin's backend exposes under /api/plugins/<id>/... */
export const RouteSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().startsWith("/"),
  /** Permissions required to call this route. Empty = authenticated user. */
  requiresPermissions: z.array(permission).default([]),
  /** If true, route is reachable without authentication (use sparingly). */
  public: z.boolean().default(false),
});
export type Route = z.infer<typeof RouteSchema>;

/** A feature flag the plugin defines; toggled per-environment/tenant by core. */
export const FeatureFlagSchema = z.object({
  key: z.string(),
  description: z.string().default(""),
  default: z.boolean().default(false),
});
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

/** A settings field the plugin exposes in its Settings panel. */
export const SettingSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["string", "number", "boolean", "secret", "select", "json"]),
  default: z.unknown().optional(),
  options: z.array(z.string()).optional(),
  description: z.string().default(""),
});
export type Setting = z.infer<typeof SettingSchema>;

/** A background/scheduled job the plugin registers. */
export const JobSchema = z.object({
  name: z.string(),
  /** Cron expression for scheduled jobs; omit for on-demand/queue-driven. */
  schedule: z.string().optional(),
  description: z.string().default(""),
});
export type Job = z.infer<typeof JobSchema>;

/**
 * A tool the plugin exposes to the AGENT PLANE (C5): a named, callable
 * capability the orchestrator/agent can invoke via the runtime's
 * `invokeTool(name, args)` seam.
 *
 * `inputSchema` is a JSON-Schema-shaped object, kept as opaque data on
 * purpose — the manifest is data, never code, so we do NOT embed a Zod
 * schema here. The core passes it through to the agent/LLM as the tool's
 * parameter description; the plugin runtime is responsible for validating
 * its own args. `permission` is enforced by the core before dispatch and
 * MUST also appear in the manifest's top-level `permissions` array (the
 * loader does not cross-check this yet — see PLUGIN_SDK notes).
 */
export const ToolSchema = z.object({
  /** Dotted, agent-facing tool name, e.g. "browser.navigate". */
  name: z
    .string()
    .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/, "tool name must be dotted lowercase, e.g. browser.navigate"),
  /** Human/LLM-readable description of what the tool does. */
  description: z.string().default(""),
  /** JSON-Schema object describing the tool's arguments. Opaque data to the core. */
  inputSchema: z.record(z.string(), z.unknown()).default({}),
  /** Permission the caller must hold to invoke this tool. */
  permission: permission,
  /**
   * HUMAN-IN-THE-LOOP (manifest v2): when true, the engine's autonomous agent
   * PAUSES the task for approval before this tool runs — the tool call is
   * recorded as a `pending_approval` step and the task goes to "paused"; a
   * human must POST /api/engine/tasks/:id/approve to let it execute (or
   * /reject to fail it). Defaults to false (tools run without a gate, as in
   * manifest v1). The global ENGINE_REQUIRE_APPROVAL_ALL env switch forces
   * approval for EVERY tool call regardless of this flag (supervised mode).
   */
  requiresApproval: z.boolean().default(false),
});
export type Tool = z.infer<typeof ToolSchema>;

/**
 * The full plugin manifest.
 */
export const PluginManifestSchema = z.object({
  /**
   * Manifest format version — lets the loader evolve without breaking
   * plugins. v2 (Engine v0.1, SDK 0.3.0): ADDITIVE — `ToolSchema` gained the
   * optional `requiresApproval` flag (default false) for the engine's
   * human-in-the-loop approval gate. A v1 manifest is still valid EXCEPT the
   * literal version stamp; bump the stamp in your manifest and nothing else
   * changes.
   */
  manifestVersion: z.literal(2),

  // --- Identity ---
  id: pluginId,
  name: z.string().min(1),
  version: versionString,
  description: z.string().default(""),
  author: z.string().default(""),
  homepage: z.string().url().optional(),
  /** GitHub repo this plugin was imported from (provenance). */
  repository: z.string().url().optional(),
  license: z.string().default("UNLICENSED"),

  // --- Compatibility ---
  /** Minimum core platform version this plugin supports. */
  minPlatformVersion: versionString,
  /** Other plugin ids this plugin depends on (loaded first). */
  dependencies: z.array(pluginId).default([]),
  /** Core services the plugin needs (e.g. "database", "redis", "queue", "storage"). */
  requiredServices: z
    .array(z.enum(["database", "redis", "queue", "storage", "search", "realtime"]))
    .default([]),

  // --- Security ---
  /** Every permission the plugin needs; the core enforces least-privilege. */
  permissions: z.array(permission).default([]),

  // --- Data ---
  /** The Postgres schema the plugin owns. Defaults to its id. */
  databaseSchema: z.string().optional(),
  /** Schema/migration version the plugin is currently at. */
  databaseVersion: versionString.optional(),

  // --- Contributions to the platform ---
  navigation: z.array(NavItemSchema).default([]),
  routes: z.array(RouteSchema).default([]),
  featureFlags: z.array(FeatureFlagSchema).default([]),
  settings: z.array(SettingSchema).default([]),
  jobs: z.array(JobSchema).default([]),
  /**
   * Agent-plane tools this plugin exposes. Optional and additive
   * (manifestVersion stays 1 — a manifest without `tools` is still valid and
   * defaults to an empty list). A plugin declaring tools SHOULD implement
   * `invokeTool` on its runtime; see `Plugin.invokeTool` in plugin.ts.
   */
  tools: z.array(ToolSchema).default([]),

  // --- Runtime ---
  /** Entrypoint module (relative to the plugin package) exporting the Plugin. */
  entry: z.string().default("dist/index.js"),
  /** Path to a health-check route the core polls; relative to the plugin mount. */
  healthCheck: z.string().startsWith("/").default("/health"),
  /** BCP-47 locales the plugin ships translations for. */
  translations: z.array(z.string()).default([]),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * Parse + validate an unknown value as a PluginManifest.
 * Throws a ZodError with a precise path if invalid — never half-accepts.
 */
export function parseManifest(input: unknown): PluginManifest {
  return PluginManifestSchema.parse(input);
}

/** Non-throwing variant for the loader to collect all errors across plugins. */
export function safeParseManifest(input: unknown) {
  return PluginManifestSchema.safeParse(input);
}
