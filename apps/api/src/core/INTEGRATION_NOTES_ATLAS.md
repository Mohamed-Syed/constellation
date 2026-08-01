# Integration notes — wiring Atlas's core services into the plugin loader

Written by Atlas (round 1, A1+A2). **I did not edit anything under
`core/plugins/**`** per my file ownership — this describes exactly what the
orchestrator (or Nova) should change there to wire the real services in.
Everything below is additive to `plugin-loader.service.ts`; nothing here
requires changing the SDK contract (`packages/plugin-sdk`).

## 1. What exists now

| Service | Module | Purpose |
|---|---|---|
| `PrismaService` | `core/database/database.module.ts` (Global) | `core`-schema Postgres access. `.db` is `PrismaClient \| undefined` — **always check for `undefined`**. |
| `PluginLoggerFactory` | `core/logging/logging.module.ts` (Global) | `.forPlugin(pluginId): PluginLogger` — structured pino logger scoped to a plugin. |
| `SettingsService` / `FeatureFlagService` | `core/settings/settings.module.ts` (Global) | Manifest-default-seeded, DB-overlaid caches. Synchronous `get()`/`isEnabled()`; async `hydrate()`/`set()`. |
| `PluginConfigFactory` | `core/settings/plugin-config.factory.ts` (exported by `SettingsModule`) | `.forPlugin(manifest): Promise<PluginConfig>` — the one-stop way to get a real `PluginConfig`. |
| `EventBusService` | `core/events/events.module.ts` (Global) | `.forPlugin(pluginId): PluginEvents` + `.emitPlatform(topic, payload)` for core-published events. |

All four modules are `@Global()`, so `PluginsModule` does not need to import
them to inject these services — they're already in the DI container once
`AppModule` boots (which it does; `app.module.ts` imports them ahead of
`PluginsModule`, see the comment there for why the order matters).

## 2. The one change needed in `plugin-loader.service.ts`

Today, `buildContext(pluginId: string)` in `PluginLoaderService` returns a
hand-rolled stub (logger via bare `new Logger()`, config that always
returns `undefined`/`false`, events that no-op). Replace its *body* with
calls into the services above. Sketch (adjust to match whatever
`PluginLoaderService`'s constructor injection looks like by the time this
lands — it will need these four services added to its constructor):

```ts
constructor(
  private readonly registry: PluginRegistryService,
  private readonly loggerFactory: PluginLoggerFactory,
  private readonly pluginConfigFactory: PluginConfigFactory,
  private readonly eventBus: EventBusService,
) {}

// buildContext needs the full manifest, not just the id, because
// PluginConfigFactory hydrates from manifest.settings / manifest.featureFlags.
private async buildContext(manifest: PluginManifest): Promise<PluginContext> {
  return {
    pluginId: manifest.id,
    logger: this.loggerFactory.forPlugin(manifest.id),
    config: await this.pluginConfigFactory.forPlugin(manifest),
    events: this.eventBus.forPlugin(manifest.id),
    // db: only when required — see §3 below.
    getPrincipal: () => undefined, // still a stub; RBAC lands in P2.
  };
}
```

Call sites: `buildContext` is currently called synchronously
(`this.buildContext(manifest.id)`) right before `runtime.register?.(...)`
inside `loadOne()`. Since `PluginConfigFactory.forPlugin()` is async (it
hydrates from the DB), that call site becomes `await this.buildContext(manifest)`
— `loadOne()` is already `async`, so this is a one-line change there plus
passing `manifest` instead of `manifest.id`.

## 3. `PluginDatabase` (the `db` field) — only for plugins that need it

Per the SDK, `PluginContext.db` is present **only if** the manifest declares
`requiredServices: ["database"]`. Build it from `PrismaService.queryInSchema`:

```ts
db: manifest.requiredServices.includes("database")
  ? {
      schema: manifest.databaseSchema ?? manifest.id,
      query: (sql, params) => this.prisma.queryInSchema(manifest.databaseSchema ?? manifest.id, sql, params),
    }
  : undefined,
```

Two things worth knowing before wiring this:

- **The schema won't exist yet.** Nothing creates a plugin's Postgres
  schema automatically today (see `core/database/README.md` § "Bootstrapping
  a new plugin's schema"). Until that lands, a plugin declaring
  `requiredServices: ["database"]` gets a `PluginDatabase` handle that will
  fail at query time if its schema was never created. That's arguably fine
  for now (isolated failure, not a boot-time failure) but flag it if you
  want `CREATE SCHEMA IF NOT EXISTS` added to the loader before `register()`.
- **`queryInSchema` returns `[]` (never throws) when there's no database at
  all** — consistent with the "boot with no DB" rule, but it does mean a
  plugin can't distinguish "no rows" from "no database" from just the
  return value. If that matters, `PrismaService.isConnected` is available
  to check first.

## 4. Suggested platform events to publish

`EventBusService.emitPlatform(topic, payload)` is there for the loader to
narrate plugin lifecycle to any plugin subscribed via `onPlatform`. Natural
call sites in `loadOne()` / wherever enable/disable lives:

- `plugin:registered` — after `this.registry.register(loaded)`
- `plugin:enabled` — after a successful `register()` (or wherever "enabled"
  state transitions happen once that exists)
- `plugin:failed` — alongside every `this.registry.setState(id, "failed", ...)`
- `plugin:disabled` — wherever disable lands

Payload shape is up to you; `{ pluginId, version }` is probably enough to
start. This is a suggestion, not a requirement — nothing else depends on
these topics existing yet.

## 5. A real gap: Prisma 7 needs a driver adapter, and it isn't installed

`@prisma/client` 7.x's `PrismaClient` **cannot be constructed at all**
without a driver adapter (e.g. `@prisma/adapter-pg`, which itself needs the
`pg` package as its peer) — not "can't connect," but "throws synchronously
in the constructor." I discovered this empirically: `prisma generate`
succeeds fine (schema → code, no DB touched), but `new PrismaClient()`
throws `"PrismaClient was instantiated without any options. A driver
adapter is required to connect to your database."` immediately.

Per my instructions I did **not** run `pnpm add` — instead `PrismaService`
dynamically `require()`s `@prisma/adapter-pg` and catches the failure as a
soft-disable (logged as a `warn`, same code path as "no `DATABASE_URL`" or
"Postgres unreachable"). Practically: **the database layer is fully wired
end-to-end except this one missing dependency pair.** Once installed, no
code changes are needed — `PrismaService.onModuleInit()` already has the
adapter-construction branch, it just currently always takes the "not
installed" fallback.

To enable real Postgres connectivity:

```bash
pnpm --filter @constellation/api add @prisma/adapter-pg pg
pnpm --filter @constellation/api add -D @types/pg
```

(I did not run this — it needs an explicit go-ahead per the "$0/local,
nothing installed without checking" ground rules, and more immediately
because installing mid-parallel-session risks the shared lockfile other
agents are using.)

Full writeup: `core/database/README.md` § "Prisma 7 driver adapters — a
real, temporary limitation."

## 6. Nothing here touches `main.ts`

`nestjs-pino`'s `Logger` (Nest's own `LoggerService` implementation, distinct
from `PluginLoggerFactory`) is available globally via `LoggingModule` but
Nest's bootstrap logger in `main.ts` hasn't been switched to it
(`app.useLogger(app.get(Logger))`, plus `NestFactory.create(AppModule, {
bufferLogs: true })` instead of `false`). `main.ts` isn't in my file
ownership for this round, so I left it alone — worth doing whenever
whoever owns `main.ts` next touches it, purely cosmetic (unifies Nest's own
startup logs with the structured pino output; nothing depends on it).
