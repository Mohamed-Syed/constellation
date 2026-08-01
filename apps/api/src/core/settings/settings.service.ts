import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service.js";

/** The subset of a manifest setting this service needs to seed a default. */
export interface SettingDefault {
  key: string;
  default?: unknown;
}

/**
 * Settings, namespaced per plugin (`pluginId = "core"` for platform-level
 * settings). Backs the SDK's `PluginConfig.get`/`getOrThrow`.
 *
 * The SDK's `PluginConfig.get` is **synchronous** — a plugin can't `await`
 * a config read mid-request. Database reads obviously can't be. The fix
 * used throughout this module: an in-memory cache is the only thing `get()`
 * ever reads, and it's hydrated (async, from manifest defaults + any DB
 * overrides) once per plugin via `hydrate()` before that plugin's
 * `PluginConfig` is handed out. See `plugin-config.factory.ts` and
 * `INTEGRATION_NOTES_ATLAS.md` for exactly where `hydrate()` gets called.
 *
 * With no database, `hydrate()` seeds the cache from manifest defaults only
 * and returns — `get()` still works, it just never sees a persisted
 * override. That's the same "boot with no DB" degradation `PrismaService`
 * documents.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, unknown>();

  constructor(private readonly prisma: PrismaService) {}

  /** Synchronous read, served entirely from the in-memory cache. */
  get<T = unknown>(pluginId: string, key: string): T | undefined {
    return this.cache.get(cacheKey(pluginId, key)) as T | undefined;
  }

  /**
   * Seed the cache for one plugin: manifest defaults first, then overlay
   * any persisted overrides from the database (if one is available). Safe
   * to call more than once (e.g. to refresh after a `set()` from another
   * process) — later calls simply re-seed the same keys.
   */
  async hydrate(pluginId: string, defaults: readonly SettingDefault[]): Promise<void> {
    for (const setting of defaults) {
      this.cache.set(cacheKey(pluginId, setting.key), setting.default);
    }

    const db = this.prisma.db;
    if (!db) return;

    try {
      const rows = await db.setting.findMany({ where: { pluginId } });
      for (const row of rows) {
        this.cache.set(cacheKey(pluginId, row.key), row.value);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to load settings for plugin "${pluginId}" from the database, using manifest defaults: ${asMessage(err)}`,
      );
    }
  }

  /** Persist a value (requires a database) and update the cache immediately. */
  async set(pluginId: string, key: string, value: unknown): Promise<void> {
    const db = this.prisma.db;
    if (!db) {
      throw new Error(`Cannot persist setting "${pluginId}.${key}": no database is available.`);
    }
    await db.setting.upsert({
      where: { pluginId_key: { pluginId, key } },
      create: { pluginId, key, value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
    });
    this.cache.set(cacheKey(pluginId, key), value);
  }
}

function cacheKey(pluginId: string, key: string): string {
  return `${pluginId}::${key}`;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
