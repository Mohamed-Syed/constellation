import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";

/** The subset of a manifest feature flag this service needs to seed a default. */
export interface FeatureFlagDefault {
  key: string;
  default: boolean;
}

/**
 * Feature flags, namespaced per plugin. Backs the SDK's
 * `PluginConfig.isFeatureEnabled`, which — like `get()` — is synchronous;
 * see `SettingsService` for why this reads from an in-memory cache hydrated
 * ahead of time rather than querying the database per call.
 */
@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);
  private readonly cache = new Map<string, boolean>();

  constructor(private readonly prisma: PrismaService) {}

  /** Synchronous read, served entirely from the in-memory cache. */
  isEnabled(pluginId: string, key: string): boolean {
    return this.cache.get(cacheKey(pluginId, key)) ?? false;
  }

  /**
   * Seed the cache for one plugin: manifest defaults first, then overlay
   * any persisted overrides from the database (if one is available).
   */
  async hydrate(pluginId: string, defaults: readonly FeatureFlagDefault[]): Promise<void> {
    for (const flag of defaults) {
      this.cache.set(cacheKey(pluginId, flag.key), flag.default);
    }

    const db = this.prisma.db;
    if (!db) return;

    try {
      const rows = await db.featureFlag.findMany({ where: { pluginId } });
      for (const row of rows) {
        this.cache.set(cacheKey(pluginId, row.key), row.enabled);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to load feature flags for plugin "${pluginId}" from the database, using manifest defaults: ${asMessage(err)}`,
      );
    }
  }

  /** Persist a value (requires a database) and update the cache immediately. */
  async setEnabled(pluginId: string, key: string, enabled: boolean): Promise<void> {
    const db = this.prisma.db;
    if (!db) {
      throw new Error(`Cannot persist feature flag "${pluginId}.${key}": no database is available.`);
    }
    await db.featureFlag.upsert({
      where: { pluginId_key: { pluginId, key } },
      create: { pluginId, key, enabled },
      update: { enabled },
    });
    this.cache.set(cacheKey(pluginId, key), enabled);
  }
}

function cacheKey(pluginId: string, key: string): string {
  return `${pluginId}::${key}`;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
