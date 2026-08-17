/**
 * PluginContext — the ONLY surface a plugin uses to talk to the platform.
 *
 * This is a capability object: the core hands each plugin a context scoped to
 * that plugin (its own logger, config namespace, DB schema, event topic prefix).
 * A plugin never imports core internals directly — it receives exactly what it
 * is allowed to use. This keeps plugins decoupled, independently testable, and
 * safe to run as separate microservices later (the context becomes an RPC stub).
 */
import type { PluginMemory } from "./memory.js";

/** Structured logger scoped to the plugin. */
export interface PluginLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): PluginLogger;
}

/** Read-only access to the plugin's own settings + feature flags. */
export interface PluginConfig {
  get<T = unknown>(key: string): T | undefined;
  getOrThrow<T = unknown>(key: string): T;
  isFeatureEnabled(flag: string): boolean;
}

/** Scoped event bus. Topics are automatically namespaced to the plugin. */
export interface PluginEvents {
  emit(topic: string, payload: unknown): void;
  on(topic: string, handler: (payload: unknown) => void | Promise<void>): void;
  /** Subscribe to a core/platform topic (requires the matching permission). */
  onPlatform(topic: string, handler: (payload: unknown) => void | Promise<void>): void;
}

/** Handle to the plugin's OWN database schema. No cross-schema access. */
export interface PluginDatabase {
  /** The Postgres schema name this plugin owns. */
  readonly schema: string;
  /** Run a parameterized query within the plugin's schema search_path. */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** The identity of the caller for the current request, if any. */
export interface PluginPrincipal {
  readonly userId: string;
  readonly roles: string[];
  hasPermission(permission: string): boolean;
}

export interface PluginContext {
  /** The plugin's own manifest id. */
  readonly pluginId: string;
  readonly logger: PluginLogger;
  readonly config: PluginConfig;
  readonly events: PluginEvents;
  /** Present only if the plugin declared `requiredServices: ["database"]`. */
  readonly db?: PluginDatabase;
  /**
   * Platform memory (the brain). Present only when the core mounts the memory
   * subsystem and the plugin declared the `core:brain:*` permissions it uses.
   * Always guard: `await ctx.memory?.query(...)`.
   */
  readonly memory?: PluginMemory;
  /**
   * Resolve the principal for the current async context (request-scoped).
   * Returns undefined for background jobs / system calls.
   */
  getPrincipal(): PluginPrincipal | undefined;
}
