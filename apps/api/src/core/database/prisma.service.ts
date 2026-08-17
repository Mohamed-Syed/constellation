import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * Owns the single Prisma connection to the platform's `core` Postgres
 * schema. Every other core service (SettingsService, FeatureFlagService,
 * the plugin registry's future persistence, …) goes through this.
 *
 * CRITICAL invariant: the platform MUST be able to boot with no database
 * running at all — local dev, CI, and a fresh clone all start with zero
 * infra. So every failure mode here is caught and logged as a warning; the
 * app keeps serving with `client` left `undefined`. Callers MUST treat
 * `client`/`db` as possibly-absent and degrade (see SettingsService for the
 * pattern: manifest defaults when there's no database).
 *
 * Prisma 7 note: `PrismaClient` no longer accepts a bare connection `url`.
 * It requires a *driver adapter* (e.g. `@prisma/adapter-pg`, which itself
 * needs the `pg` package) — see https://pris.ly/d/driver-adapters. Neither
 * is an installed dependency of this workspace yet (see
 * `core/database/README.md`). Until they're
 * added, this service degrades to "no database" even when `DATABASE_URL`
 * is set and Postgres is reachable — that's a real, temporary limitation,
 * not a bug: constructing `PrismaClient` without an adapter throws
 * synchronously, so we catch exactly that and keep booting.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private prismaClient: PrismaClient | undefined;

  async onModuleInit(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) {
      this.logger.warn(
        "DATABASE_URL is not set — database layer disabled, platform continues without persistence.",
      );
      return;
    }

    // Driver adapter is required by Prisma 7's PrismaClient. Resolved
    // dynamically (not a static `import`) so a missing optional dependency
    // is a soft-disable, not a build-time or boot-time failure.
    let adapter: unknown;
    try {
      // NOT an installed dependency today — see README.md in this folder.
      const { PrismaPg } = require("@prisma/adapter-pg") as {
        PrismaPg: new (config: { connectionString: string }) => unknown;
      };
      adapter = new PrismaPg({ connectionString: url });
    } catch (err) {
      this.logger.warn(
        'Driver adapter "@prisma/adapter-pg" (+ its "pg" peer) is not installed. ' +
          "Prisma 7 requires a driver adapter to construct a client at all, even before " +
          "connecting. Database layer disabled; add the dependency to enable persistence. " +
          `(${asMessage(err)})`,
      );
      return;
    }

    try {
      const client = new PrismaClient({ adapter: adapter as never });
      await client.$connect();
      this.prismaClient = client;
      this.logger.log("Connected to Postgres (core schema).");
    } catch (err) {
      this.logger.warn(`Database connection failed — continuing without persistence: ${asMessage(err)}`);
      this.prismaClient = undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.prismaClient) return;
    await this.prismaClient.$disconnect().catch((err: unknown) => {
      this.logger.warn(`Error disconnecting Prisma client: ${asMessage(err)}`);
    });
  }

  /** True once a live database connection has been established. */
  get isConnected(): boolean {
    return this.prismaClient !== undefined;
  }

  /**
   * The raw Prisma client, or `undefined` if no database is available.
   * Every caller MUST handle the `undefined` case — see SettingsService /
   * FeatureFlagService for the standard fallback-to-manifest-defaults
   * pattern.
   */
  get db(): PrismaClient | undefined {
    return this.prismaClient;
  }

  /**
   * Run a raw parameterized query against a plugin's own Postgres schema
   * (via `search_path`), NOT the `core` schema modeled by this file's
   * Prisma schema. This is the primitive the eventual `PluginDatabase`
   * (SDK `PluginContext.db`) implementation is built on — see
   * `core/database/README.md`. Returns an
   * empty array (never throws) when there's no database, matching the
   * "boot with no DB" invariant.
   *
   * `schema` MUST already be validated as a safe identifier by the caller
   * (the SDK's plugin id regex — `^[a-z][a-z0-9-]{1,62}$` — is safe to
   * interpolate; this function does not re-validate it).
   *
   * `SET search_path` and the query are run inside one `$transaction` so
   * both statements execute on the same pooled connection — Postgres
   * session settings like `search_path` don't survive a connection swap,
   * and a bare `$queryRawUnsafe` cannot send multiple statements in one
   * call (the extended query protocol Prisma uses only allows one).
   */
  async queryInSchema<T = unknown>(schema: string, sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.prismaClient) return [];
    const client = this.prismaClient;
    const [, rows] = await client.$transaction([
      client.$executeRawUnsafe(`SET search_path TO "${schema}"`),
      client.$queryRawUnsafe<T[]>(sql, ...params),
    ]);
    return rows;
  }

  /**
   * Bootstrap a per-plugin Postgres schema (C8): issue
   * `CREATE SCHEMA IF NOT EXISTS "<schema>"` against the platform's OWN
   * Postgres connection. This closes the documented "before a plugin's
   * first DB use, its schema may not exist" leak — see
   * `core/database/README.md` → "Bootstrapping a new plugin's schema".
   *
   * Idempotent (IF NOT EXISTS) and gracefully-degrading: no database, an
   * invalid schema name, or a failed statement all log a warning and return
   * `false` — the boot/plugin-load never crashes because of a schema.
   *
   * `schema` is interpolated into the SQL, so it MUST already be validated
   * as a safe identifier by the caller (the SDK's plugin-id regex
   * `^[a-z][a-z0-9-]{1,62}$` is safe; this function does NOT re-validate
   * it, matching `queryInSchema`).
   *
   * @returns true if the schema is known to exist (created now or already),
   *   false when there's no database or the statement failed.
   */
  async bootstrapSchema(schema: string): Promise<boolean> {
    if (!this.prismaClient) {
      this.logger.warn(`Cannot bootstrap schema "${schema}": no database is available.`);
      return false;
    }
    // Defensive: only bootstrap an identifier-shaped schema name. The value
    // comes from a plugin manifest (`databaseSchema` or the plugin `id`); the
    // plugin `id` is validator-constrained kebab-case, but `databaseSchema` is
    // plugin-authored, so reject anything that would break out of the double
    // quotes in the interpolated `CREATE SCHEMA` before it reaches Postgres.
    // (Same trust boundary as the plugin itself — a plugin that can choose
    // this string already runs in-process — but never interpolate attacker-
    // shaped input into raw SQL.)
    if (!/^[a-z][a-z0-9_]{0,62}$/i.test(schema)) {
      this.logger.warn(`Refusing to bootstrap non-identifier schema "${schema}".`);
      return false;
    }
    // Prisma's extended query protocol permits exactly one statement per
    // call, and `CREATE SCHEMA IF NOT EXISTS` is a single safe statement.
    // `$executeRawUnsafe` returns the affected row count.
    try {
      await this.prismaClient.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      this.logger.log(`Ensured per-plugin schema "${schema}" exists.`);
      return true;
    } catch (err) {
      // E.g. an interpolated name that isn't a valid identifier, or a
      // transient connection error — degrade, never throw.
      this.logger.warn(
        `Failed to bootstrap per-plugin schema "${schema}" — continuing: ${asMessage(err)}`,
      );
      return false;
    }
  }
}

export type { Prisma };

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
