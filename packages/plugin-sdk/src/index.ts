/**
 * @constellation/plugin-sdk — public surface.
 *
 * Everything a plugin author or the core needs to build against the platform.
 * Import from "@constellation/plugin-sdk"; never reach into subpaths.
 */
export const PLATFORM_VERSION = "0.1.0";

export * from "./manifest.js";
export * from "./context.js";
export * from "./plugin.js";
export * from "./permissions.js";
