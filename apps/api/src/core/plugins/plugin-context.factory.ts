import { Injectable, Logger } from "@nestjs/common";
import type {
  PluginContext,
  PluginLogger,
  PluginManifest,
} from "@constellation/plugin-sdk";
import { PrismaService } from "../database/prisma.service.js";
import { EventBusService } from "../events/event-bus.service.js";
import { PluginLoggerFactory } from "../logging/plugin-logger.factory.js";
import { PluginConfigFactory } from "../settings/plugin-config.factory.js";

/**
 * Builds the capability object (`PluginContext`) handed to a plugin for every
 * lifecycle hook call (`register`/`enable`/`disable`/`health`/…). Injected into
 * the loader, the lifecycle service, and the health poller so every hook sees
 * the same real, service-backed context: pino logger, DB-overlaid settings +
 * feature flags, the namespaced event bus, and (only when the manifest declares
 * `requiredServices: ["database"]`) a `PluginDatabase` scoped to the plugin's
 * own Postgres schema.
 *
 * Wired per `core/INTEGRATION_NOTES_ATLAS.md`. The three consumers depend on
 * this factory `@Optional()`-ly and fall back to {@link stubContext} when it is
 * absent (the offline unit tests construct the services by hand with no DI
 * container, so no factory is present there — see `plugin-loader.test.ts`).
 */
@Injectable()
export class PluginContextFactory {
  constructor(
    private readonly loggerFactory: PluginLoggerFactory,
    private readonly configFactory: PluginConfigFactory,
    private readonly eventBus: EventBusService,
    private readonly prisma: PrismaService,
  ) {}

  async build(manifest: PluginManifest): Promise<PluginContext> {
    const schema = manifest.databaseSchema ?? manifest.id;
    return {
      pluginId: manifest.id,
      logger: this.loggerFactory.forPlugin(manifest.id),
      config: await this.configFactory.forPlugin(manifest),
      events: this.eventBus.forPlugin(manifest.id),
      db: manifest.requiredServices.includes("database")
        ? {
            schema,
            query: <T = unknown>(sql: string, params?: unknown[]) =>
              this.prisma.queryInSchema<T>(schema, sql, params ?? []),
          }
        : undefined,
      getPrincipal: () => undefined, // still a stub; RBAC principal lands in P2.
    };
  }
}

/**
 * Resolve a `PluginContext` for a manifest, preferring the real DI-backed
 * factory and falling back to the dependency-free {@link stubContext} when no
 * factory is available (offline tests). One shared entry point so the loader,
 * lifecycle, and health services never diverge in how they build a context.
 */
export function buildContextWith(
  factory: PluginContextFactory | undefined,
  manifest: PluginManifest,
): Promise<PluginContext> {
  return factory ? factory.build(manifest) : Promise.resolve(stubContext(manifest.id));
}

/**
 * Dependency-free fallback context: a real Nest-logger-backed `PluginLogger`,
 * plus inert config/events. Used only when the DI factory is absent (unit
 * tests). Production always gets {@link PluginContextFactory.build}.
 */
export function stubContext(pluginId: string): PluginContext {
  const nestLogger = new Logger(`plugin:${pluginId}`);
  const logger: PluginLogger = {
    debug: (m: string) => nestLogger.debug(m),
    info: (m: string) => nestLogger.log(m),
    warn: (m: string) => nestLogger.warn(m),
    error: (m: string) => nestLogger.error(m),
    child: () => logger,
  };
  return {
    pluginId,
    logger,
    config: {
      get: () => undefined,
      getOrThrow: () => {
        throw new Error("config not available (no PluginContextFactory wired)");
      },
      isFeatureEnabled: () => false,
    },
    events: {
      emit: () => undefined,
      on: () => undefined,
      onPlatform: () => undefined,
    },
    getPrincipal: () => undefined,
  };
}
