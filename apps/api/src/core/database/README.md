# Data layer: core schema + per-plugin schemas

Locked decisions this implements: **C8** (each plugin owns its own Postgres
schema; no shared tables unless necessary) and **C9** (Prisma as the ORM).

## Two kinds of schema, two kinds of ownership

1. **`core` schema** — owned by this file's neighbor, `apps/api/prisma/schema.prisma`,
   and connected to by `PrismaService` in this folder. It holds ONLY
   platform-level tables: `PluginInstallation`, `Setting`, `FeatureFlag`,
   `AuditLog`. Nothing plugin-specific ever gets added here.
2. **One schema per plugin** (`<pluginId>` by default — see the manifest's
   `databaseSchema` field, which defaults to the plugin's `id`) — owned
   entirely by that plugin. The core never defines, migrates, or queries a
   plugin's tables directly; it only knows the schema *name* exists.

This mirrors how the SDK models it (`packages/plugin-sdk/src/context.ts`):

```ts
export interface PluginDatabase {
  readonly schema: string;                 // the plugin's own Postgres schema
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>; // scoped to it
}
```

A plugin's `PluginContext.db` is only present when its manifest declares
`requiredServices: ["database"]`. It is a narrow capability: raw
parameterized queries against the plugin's own schema. No cross-schema
access, no shared connection pool tuning knobs, no visibility into `core` or
any other plugin's schema.

## How a plugin owns its schema + migrations

A plugin that wants Prisma-managed migrations runs its own, completely
separate Prisma project:

```
plugins/<plugin-name>/
  prisma/
    schema.prisma      # datasource → same Postgres instance, own schema
    migrations/         # this plugin's own migration history
  src/...
```

Its `schema.prisma` looks like this (illustrative — every plugin's own repo
owns this file, not the core):

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "./generated"       // keep each plugin's client out of the core's node_modules
}

datasource db {
  provider = "postgresql"
  schemas  = ["billing"]          // <- this plugin's own schema name
}
```

```
# prisma.config.ts (Prisma 7 — see "Prisma 7 CLI config" below)
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL },
});
```

The plugin runs `prisma migrate dev` / `prisma migrate deploy` from its own
package against its own schema — completely independent of the core's
migration history. `pnpm --filter <plugin> prisma:migrate` (or the
plugin's own script) is how that gets triggered; the core process never
calls a plugin's migration tooling. This is what "independent migrations"
(C8) means in practice: a plugin can add a column or a whole new table
without the core ever being rebuilt, redeployed, or even aware of the
change beyond "the schema now has more stuff in it."

A plugin that doesn't want a full second Prisma project can instead just
run its own `.sql` migration files (any tool: `node-pg-migrate`, plain SQL
scripts run once, etc.) against its own schema — Prisma isn't mandatory for
plugins, only for the core. Either way, the contract with the core is the
same: "give me a schema name, I'll do the rest."

## Bootstrapping a new plugin's schema

Nothing in the core creates a plugin's Postgres schema automatically yet —
that's a P2+ concern (likely: the plugin loader runs
`CREATE SCHEMA IF NOT EXISTS "<pluginId>"` before invoking the plugin's own
migration step, gated behind the `database` required service). For now,
during local development, create it by hand:

```sql
CREATE SCHEMA IF NOT EXISTS "<plugin-id>";
```

## `PrismaService` — how the core connects

`prisma.service.ts` is the single owner of the connection to the `core`
schema. Two invariants drive its design:

- **The platform MUST boot with no database running.** Local dev, CI, and a
  fresh clone all start with zero infra. Every failure mode — no
  `DATABASE_URL`, Postgres unreachable, missing driver adapter (see below)
  — is caught and logged as a `warn`, never thrown. `PrismaService.db`
  (and `.isConnected`) tell callers whether a database is actually
  available; every consumer (`SettingsService`, `FeatureFlagService`, …)
  degrades to manifest defaults when it isn't.
- **Only the `core` schema is modeled by Prisma here.** Plugin schemas are
  reached, if at all, through `PrismaService.queryInSchema(schema, sql,
  params)` — a thin `SET search_path` + raw-query primitive, not a modeled
  Prisma client. That's intentional: the core has no business knowing a
  plugin's table shapes.

## Prisma 7 driver adapters — a real, temporary limitation

Prisma 7's `PrismaClient` no longer accepts a bare `url` and no longer talks
to Postgres via a bundled native engine binary. It **requires a driver
adapter** — for Postgres, `@prisma/adapter-pg` (which itself needs the `pg`
package) — passed to the constructor:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
```

**Neither `@prisma/adapter-pg` nor `pg` is an installed dependency of this
workspace.** `new PrismaClient()` with no adapter throws *synchronously*,
before any connection attempt — this isn't a "can't reach the database"
failure, it's "can't even construct the client." `PrismaService` catches
exactly this (a dynamic, non-static `require("@prisma/adapter-pg")` that
fails softly) and logs a clear warning, so the platform still boots and
serves — but real Postgres connectivity is off until those two packages are
added. See `INTEGRATION_NOTES_ATLAS.md` (one level up) for the exact
install command and why it wasn't run as part of this change.

## Prisma 7 CLI config

The connection URL used by `prisma generate` / `migrate` / `studio` no
longer lives in `schema.prisma` (Prisma rejects a `datasource.url` there
now). It lives in `apps/api/prisma.config.ts` instead, which the CLI loads
automatically. That file intentionally falls back to a placeholder URL
when `DATABASE_URL` is unset, so `prisma generate` — a schema-to-code step
that touches no database — always succeeds offline. `migrate`/`studio`
still need a real `DATABASE_URL` in the environment, same as always.

## Scripts

From `apps/api/`:

```bash
pnpm prisma:generate         # regenerate the Prisma Client from schema.prisma
pnpm prisma:migrate          # create + apply a dev migration (needs DATABASE_URL)
pnpm prisma:migrate:deploy   # apply pending migrations, no prompts (CI/prod)
pnpm prisma:studio           # browse the core schema (needs DATABASE_URL)
```
