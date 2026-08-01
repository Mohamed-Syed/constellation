/**
 * The Plugin runtime contract.
 *
 * A plugin package's `entry` module must `export default` an object (or class
 * instance) satisfying `Plugin`. The core loads the manifest first (data), then
 * the entry (code), then drives this lifecycle. Every hook is optional except
 * that a plugin must expose its manifest id via the manifest file; the runtime
 * object carries behavior only.
 *
 * Lifecycle: install? -> register -> enable -> [running] -> disable -> uninstall?
 * Hooks are idempotent and must not throw for expected conditions; throwing
 * marks the plugin unhealthy and the core isolates it (the rest keep running).
 */
import type { PluginContext } from "./context.js";
import type { PluginManifest } from "./manifest.js";

export interface HealthResult {
  status: "ok" | "degraded" | "down";
  detail?: string;
  /** Optional structured checks (dependency: ok/down). */
  checks?: Record<string, "ok" | "down">;
}

export interface Plugin {
  /**
   * Called once when the plugin is first installed (before first enable).
   * Use for one-time setup: create the DB schema, seed defaults, etc.
   * Migrations proper are run by the core's migration runner, not here.
   */
  install?(ctx: PluginContext): Promise<void> | void;

  /**
   * Called on every boot after the manifest is validated and dependencies are
   * loaded. Register routes/handlers/jobs against the context here. Must NOT
   * perform heavy work — keep boot fast.
   */
  register?(ctx: PluginContext): Promise<void> | void;

  /** Called when the plugin transitions to enabled (start jobs, open resources). */
  enable?(ctx: PluginContext): Promise<void> | void;

  /** Called when the plugin is disabled (stop jobs, release resources). Must be clean. */
  disable?(ctx: PluginContext): Promise<void> | void;

  /** Called when the plugin is being removed. Tear down owned resources. */
  uninstall?(ctx: PluginContext): Promise<void> | void;

  /**
   * Liveness/health probe polled by the core. Should be cheap and fast.
   * Default (if omitted): the core reports "ok" as long as the plugin loaded.
   */
  health?(ctx: PluginContext): Promise<HealthResult> | HealthResult;
}

/**
 * A loaded plugin as the core tracks it: manifest (data) + runtime (code) +
 * lifecycle state. Exported so the loader and registry share one shape.
 */
export type PluginState =
  | "discovered"
  | "validated"
  | "registered"
  | "enabled"
  | "disabled"
  | "failed";

export interface LoadedPlugin {
  manifest: PluginManifest;
  runtime: Plugin;
  state: PluginState;
  /** Absolute path to the plugin package directory. */
  dir: string;
  /** Populated when state === "failed". */
  error?: string;
}

/**
 * Helper for plugin authors: gives editor autocomplete + a compile-time check
 * that the default export matches the contract.
 *
 *   export default definePlugin({ register(ctx) { ... } });
 */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
