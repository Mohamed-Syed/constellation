import { Inject, Injectable } from "@nestjs/common";
import type { Logger as PinoInstance } from "pino";
import type { PluginLogger } from "@constellation/plugin-sdk";
import { PLATFORM_LOGGER } from "./logging.constants.js";

/**
 * Builds SDK-shaped `PluginLogger`s backed by the platform's shared pino
 * instance, each scoped with `{ plugin: <id> }` bindings so every log line
 * a plugin emits is attributable and machine-filterable (`plugin:"foo"` in
 * whatever log pipeline consumes the JSON output).
 */
@Injectable()
export class PluginLoggerFactory {
  constructor(@Inject(PLATFORM_LOGGER) private readonly root: PinoInstance) {}

  /** A structured logger scoped to one plugin, matching the SDK's `PluginLogger`. */
  forPlugin(pluginId: string): PluginLogger {
    return wrap(this.root.child({ plugin: pluginId }));
  }
}

function wrap(pino: PinoInstance): PluginLogger {
  return {
    debug: (message, meta) => (meta ? pino.debug(meta, message) : pino.debug(message)),
    info: (message, meta) => (meta ? pino.info(meta, message) : pino.info(message)),
    warn: (message, meta) => (meta ? pino.warn(meta, message) : pino.warn(message)),
    error: (message, meta) => (meta ? pino.error(meta, message) : pino.error(message)),
    child: (bindings) => wrap(pino.child(bindings)),
  };
}
