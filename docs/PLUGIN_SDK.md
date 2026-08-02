# Building a Constellation Plugin

Everything you need to build, ship, and load a plugin into Constellation. Written for an
external developer — you shouldn't need any other context.

If something here disagrees with the code, the code wins: the contract lives in
[`packages/plugin-sdk/src`](../packages/plugin-sdk/src), and the loader that enforces it lives
in [`apps/api/src/core/plugins`](../apps/api/src/core/plugins).

> Also see [`docs/MASTER_PLAN.md`](./MASTER_PLAN.md) for the platform's overall architecture
> and roadmap. This guide only covers the plugin authoring surface.

---

## 1. The model, in one paragraph

A plugin is a directory dropped into `/plugins` containing a `plugin.manifest.json` (**data**,
validated with [Zod](https://zod.dev)) and a built JS entry file (**code**) that exports an
object implementing the `Plugin` lifecycle interface. On boot, the core's plugin loader scans
`/plugins`, validates every manifest, resolves load order by declared `dependencies`, imports
each entry module, and drives it through `register()` → `enable()`. From then on your plugin
talks to the platform through exactly one object — `PluginContext` — and nothing else. You never
import core internals, and the core never needs code changes to pick up a new plugin.

That's the whole model: **manifest declares, context capabilities, lifecycle drives.**

---

## 2. Quick start: build `hello-world` from scratch

The repo already ships this exact plugin at [`plugins/hello-world`](../plugins/hello-world) —
use it as a working reference while you follow along, or copy it as a starting point.

### 2.1 Folder layout

```
plugins/hello-world/
├── package.json          # name, build script, @constellation/plugin-sdk dependency
├── tsconfig.json          # extends the repo's tsconfig.base.json
├── plugin.manifest.json   # the manifest — validated by the core at load time
└── src/
    └── index.ts           # the runtime entry — exports default a Plugin
```

Nothing else is required. No `dist/` in source control — it's built.

### 2.2 `package.json`

```json
{
  "name": "@constellation/plugin-hello-world",
  "version": "0.1.0",
  "description": "Reference plugin for Constellation.",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist .turbo"
  },
  "dependencies": {
    "@constellation/plugin-sdk": "workspace:*"
  },
  "devDependencies": {
    "rimraf": "^6.0.1",
    "typescript": "^5.7.2"
  }
}
```

Key points:
- `"type": "module"` — plugin entries are **ESM**. The loader imports them via a real dynamic
  `import()` (see §7.3); a CommonJS entry will not load.
- Depend on `@constellation/plugin-sdk` (via `workspace:*` if you're building inside this
  monorepo; a published version number once the SDK ships externally).
- `main`/the manifest's `entry` field both point at the **built** output (`dist/index.js`), not
  your TypeScript source.

### 2.3 `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules"]
}
```

`tsconfig.base.json` (repo root) already turns on `strict`, `noUncheckedIndexedAccess`, and the
other rigor flags — inherit them rather than loosening.

### 2.4 `plugin.manifest.json`

```json
{
  "manifestVersion": 2,
  "id": "hello-world",
  "name": "Hello World",
  "version": "0.1.0",
  "description": "Reference plugin demonstrating the Constellation Plugin SDK.",
  "author": "Constellation",
  "license": "MIT",
  "minPlatformVersion": "0.1.0",
  "permissions": ["hello-world:greeting:read"],
  "requiredServices": [],
  "navigation": [
    {
      "id": "hello-world-home",
      "label": "Hello World",
      "path": "/hello-world",
      "icon": "sparkles",
      "order": 50,
      "requiresPermissions": ["hello-world:greeting:read"]
    }
  ],
  "routes": [
    { "method": "GET", "path": "/greeting", "requiresPermissions": ["hello-world:greeting:read"] }
  ],
  "featureFlags": [
    { "key": "friendly-tone", "description": "Use a warmer greeting.", "default": true }
  ],
  "settings": [
    { "key": "greetingName", "label": "Who to greet", "type": "string", "default": "World" }
  ],
  "entry": "dist/index.js",
  "healthCheck": "/health"
}
```

This is parsed with `PluginManifestSchema.parse()` — see §4 below for what every field means and
which ones are required.

### 2.5 `src/index.ts`

```ts
import { definePlugin, type HealthResult, type PluginContext } from "@constellation/plugin-sdk";

export default definePlugin({
  register(ctx: PluginContext): void {
    ctx.logger.info("hello-world registered");
  },

  enable(ctx: PluginContext): void {
    const name = ctx.config.get<string>("greetingName") ?? "World";
    ctx.logger.info(`hello-world enabled — greeting ${name}`);
  },

  health(): HealthResult {
    return { status: "ok", detail: "hello-world is happy" };
  },
});
```

`definePlugin()` is a no-op at runtime — it exists purely so your editor and `tsc` check the
object you export actually satisfies `Plugin` (see §5).

### 2.6 Build it and drop it in

```bash
# from the plugin's own directory
pnpm install         # once, at the repo root, if you haven't
pnpm --filter @constellation/plugin-hello-world build   # emits dist/index.js
```

Then make sure the directory lives under the core's plugins directory (`PLUGINS_DIR` env var,
default `plugins/` at the repo root — see §7.1) and (re)start the core:

```bash
pnpm --filter @constellation/api dev
```

Watch the boot log:

```
[PluginLoaderService] Scanning for plugins in .../plugins
[PluginLoaderService] Registered plugin "hello-world" v0.1.0
[PluginLifecycleService] Enabled plugin "hello-world"
[PluginLoaderService] Plugin load complete: 1 ok, 0 failed, 1 total
```

Verify over HTTP:

```bash
curl http://localhost:4000/api/plugins
curl http://localhost:4000/api/plugins/hello-world
curl http://localhost:4000/api/health   # aggregate: plugin counts + status
```

And in the portal (`apps/web`, port 3000): the sidebar now shows a **Hello World** entry (nav
`order: 50` places it among other plugin items, sorted lowest-first) with the `sparkles` icon,
and the Modules page lists it with its state badge. No portal code changes were needed — that's
the point.

That's the whole loop: **write manifest + entry → build → drop in `/plugins` → restart the
core.** No plugin registry to register with, no core PR to open.

---

## 3. Plugin folder layout (reference)

| Path | Required | Purpose |
|---|---|---|
| `plugin.manifest.json` | **yes** | The manifest. Must sit at the plugin's directory root — the loader looks for exactly this filename. |
| `<entry>` (default `dist/index.js`) | only if you have runtime behavior | Built ESM module whose `default` export satisfies `Plugin`. A manifest with no built entry at that path loads as **manifest-only** (validated + registered, but no lifecycle hooks run) — useful while scaffolding. |
| `src/` | no (convention) | Your TypeScript source; build it to `dist/` yourself. The core never compiles plugin source. |
| `package.json`, `tsconfig.json` | no (convention) | Needed if you want normal TS tooling / to build inside this monorepo's workspace. |

The plugin's **id doubles as its Postgres schema name** by default (`databaseSchema` in the
manifest overrides this) — keep `id` kebab-case and stable once you've shipped data against it.

---

## 4. The manifest — full field reference

Source of truth: [`packages/plugin-sdk/src/manifest.ts`](../packages/plugin-sdk/src/manifest.ts)
(`PluginManifestSchema`, a Zod schema). Every field below is validated at load time — an invalid
manifest fails loudly (`state: "failed"`, with the exact Zod path + message) rather than
half-loading.

### Identity

| Field | Type | Required | Notes |
|---|---|---|---|
| `manifestVersion` | `2` (literal) | yes | Lets the loader evolve the schema without breaking old plugins. **v2 (Engine v0.1, SDK 0.3.0): ADDITIVE — the agent-plane `tools` entries gained an optional `requiresApproval` flag (default `false`).** A v1 manifest is valid apart from the literal stamp: bump it to `2` and nothing else changes. |
| `id` | string | yes | `^[a-z][a-z0-9-]{1,62}$` — kebab-case, starts with a letter. Also the default Postgres schema name. |
| `name` | string | yes | Human-readable display name (shown in the portal). |
| `version` | string | yes | Semver-ish: `^\d+\.\d+\.\d+(?:[-+].+)?$`. |
| `description` | string | no (default `""`) | Shown on the Modules page. |
| `author` | string | no (default `""`) | |
| `homepage` | URL | no | |
| `repository` | URL | no | Provenance — the GitHub repo this plugin was imported from. |
| `license` | string | no (default `"UNLICENSED"`) | |

### Compatibility

| Field | Type | Required | Notes |
|---|---|---|---|
| `minPlatformVersion` | semver string | yes | Loader compares against `PLATFORM_VERSION` (currently `0.1.0`, exported from the SDK). Your plugin is marked `failed` with a clear reason if the running core is older. |
| `dependencies` | `string[]` (plugin ids) | no (default `[]`) | Other plugins that must load first. The loader topologically sorts by this graph; a missing dependency, a cycle, or a failed dependency marks your plugin `failed` too, with the root cause named. |
| `requiredServices` | `("database" \| "redis" \| "queue" \| "storage" \| "search" \| "realtime")[]` | no (default `[]`) | Declares infra your plugin needs. `PluginContext.db` is only populated when `"database"` is listed (today it's always `undefined` — see §5.4). |

### Security

| Field | Type | Required | Notes |
|---|---|---|---|
| `permissions` | `string[]` | no (default `[]`) | Every colon-scoped permission your plugin needs, e.g. `"billing:invoice:write"`. See §6. The core enforces least-privilege — declare everything you actually check. |

### Data

| Field | Type | Required | Notes |
|---|---|---|---|
| `databaseSchema` | string | no (defaults to `id`) | The Postgres schema this plugin owns. No plugin may read/write another's schema — see [`MASTER_PLAN.md`](./MASTER_PLAN.md) C8. |
| `databaseVersion` | semver string | no | Your schema/migration version, for the (forthcoming) migration runner. |

### Contributions to the platform

| Field | Type | Required | Notes |
|---|---|---|---|
| `navigation` | `NavItem[]` | no (default `[]`) | Sidebar/command-palette entries. See §8 — this is what `apps/web` reads to build the nav, live, with zero portal code changes. |
| `routes` | `Route[]` | no (default `[]`) | HTTP routes your backend exposes under `/api/plugins/<id>/...`. Declarative today (documents the surface); the core doesn't yet auto-mount handlers from this list — you still register real NestJS routes yourself once your plugin ships a backend module. Treat it as the contract your `routes` should match. |
| `featureFlags` | `FeatureFlag[]` | no (default `[]`) | `{ key, description, default }`. Read at runtime via `ctx.config.isFeatureEnabled(key)` (stubbed today — see §5.2). |
| `settings` | `Setting[]` | no (default `[]`) | User-configurable fields (`string \| number \| boolean \| secret \| select \| json`) the portal's Settings page will render a panel for once the settings service ships. |
| `jobs` | `Job[]` | no (default `[]`) | Background/scheduled jobs you register, `{ name, schedule?, description }`. `schedule` is a cron expression; omit it for on-demand/queue-driven jobs. |

**`NavItem` shape** (each entry in `navigation`):

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within your plugin. |
| `label` | string | Shown in the sidebar/palette. |
| `path` | string, starts with `/` | Relative to your plugin's route mount. The portal links to `/modules/<your-plugin-id><path>` (`/` → the bare `/modules/<id>`). |
| `icon` | string, optional | A [Lucide](https://lucide.dev/icons) icon name. The portal's resolver (`apps/web/src/lib/icons.ts`) is case/format-tolerant — `"sparkles"`, `"Sparkles"`, and `"SPARKLES"` all resolve the same way — but only recognizes a curated subset of common icons; an unrecognized name falls back to a generic module glyph rather than erroring, so pick a real Lucide name but don't worry about exact casing. |
| `order` | number, default `100` | Lower sorts first, alongside every other plugin's items. Core platform items reserve roughly `0–10` (Dashboard, Modules) and `900+` (Settings, Admin) — pick something in between unless you have a reason not to. |
| `requiresPermissions` | `string[]`, default `[]` | Item is only shown to a principal holding **all** of these. (Not yet enforced client-side — no auth/principal is wired into the portal yet; declare it anyway so it's correct once RBAC lands.) |

### Runtime

| Field | Type | Required | Notes |
|---|---|---|---|
| `entry` | string | no (default `"dist/index.js"`) | Path to your built entry module, relative to the plugin directory. Must `export default` an object satisfying `Plugin`. |
| `healthCheck` | string, starts with `/` | no (default `"/health"`) | Documents where a health HTTP endpoint would live if you expose one over your `routes`. The core's actual health polling calls your **`health()` lifecycle hook** (§5), not this HTTP path — the two are currently separate; this field is metadata for future HTTP-level health federation. |
| `translations` | `string[]` | no (default `[]`) | BCP-47 locales you ship translations for (e.g. `["en", "fr"]`). Informational today — no i18n loader consumes it yet. |

---

## 5. The `Plugin` lifecycle

Source: [`packages/plugin-sdk/src/plugin.ts`](../packages/plugin-sdk/src/plugin.ts).

```ts
interface Plugin {
  install?(ctx: PluginContext): Promise<void> | void;
  register?(ctx: PluginContext): Promise<void> | void;
  enable?(ctx: PluginContext): Promise<void> | void;
  disable?(ctx: PluginContext): Promise<void> | void;
  uninstall?(ctx: PluginContext): Promise<void> | void;
  health?(ctx: PluginContext): Promise<HealthResult> | HealthResult;
}
```

**Every hook is optional.** Implement only what you need; a plugin with no runtime behavior at
all (just a manifest) loads fine and reports its declared contributions.

| Hook | When it's called today | What to do here |
|---|---|---|
| `install` | **Not yet driven by the core.** The type exists for the install/marketplace flow (roadmap P2+); no current code path calls it. Don't rely on it running. | One-time setup: create your schema, seed defaults. Migrations proper belong to the (forthcoming) migration runner, not here. |
| `register` | Once, at boot, right after your manifest passes validation and platform-version/dependency checks — **before** enable. A throw here marks your plugin `failed` and it's skipped; the rest of the core and other plugins are unaffected. | Register routes/handlers/jobs against the context. Keep it fast — boot blocks on every plugin's `register()` in dependency order. |
| `enable` | Automatically, right after a successful `register()`, for every plugin that reaches `state: "registered"` (today the core enables everything that registers cleanly — there's no persisted per-plugin on/off yet; see the note in `plugin-lifecycle.service.ts`). Also callable individually once an admin enable/disable API ships. A throw marks the plugin `failed`. | Start jobs, open resources/connections you'll hold onto while enabled. |
| `disable` | Not yet reachable from any UI (no admin API wired up), but the lifecycle service supports it (`PluginLifecycleService.disable(id)`) for when that ships. Only valid from `state: "enabled"`; idempotent if already disabled. | Stop jobs, release resources you opened in `enable()`. Must be clean — this can run right before `uninstall`. |
| `uninstall` | **Not yet driven by the core**, same status as `install`. | Tear down anything you own permanently (drop your schema, etc. — with real user confirmation once wired). |
| `health` | Polled on an interval by `PluginHealthService` (default every 30s, `PLUGIN_HEALTH_POLL_INTERVAL_MS` to change it, `0` disables) for every plugin in `state: "enabled"`, with a timeout (`PLUGIN_HEALTH_POLL_TIMEOUT_MS`, default 5s). **If you omit `health()`, the platform reports `"ok"` by default** — implement it once you have something real to check (a DB connection, an upstream dependency, queue depth, whatever "healthy" means for you). | Return fast. A throw or timeout is recorded as `{ status: "down", detail: "..." }` — it never affects your plugin's lifecycle `state`, only the health shown in `GET /api/plugins` (`health`, `healthCheckedAt`) and folded into `GET /api/health`'s aggregate. |

**Isolation is the whole point.** Every hook call is wrapped so a throw only fails *your*
plugin — it's marked `failed` with the exact error, and the core plus every other plugin keep
running. Don't build defensively around "what if another plugin crashes" — you're isolated by
construction. Do build defensively around *your own* hooks throwing on bad input; a throw simply
means your plugin (or the specific health poll) is now visibly broken, not silently wrong.

Use `definePlugin()` for editor/compiler safety:

```ts
export default definePlugin({
  register(ctx) { ... },
});
```

It's an identity function — purely a typed helper so a typo'd hook name or wrong signature is a
compile error instead of a silent no-op.

---

## 6. `PluginContext` — your only door into the platform

Source: [`packages/plugin-sdk/src/context.ts`](../packages/plugin-sdk/src/context.ts). Every
lifecycle hook receives one, built fresh per call by
`apps/api/src/core/plugins/plugin-context.factory.ts`.

```ts
interface PluginContext {
  readonly pluginId: string;
  readonly logger: PluginLogger;
  readonly config: PluginConfig;
  readonly events: PluginEvents;
  readonly db?: PluginDatabase;       // only if you declared requiredServices: ["database"]
  getPrincipal(): PluginPrincipal | undefined;
}
```

**Be aware of what's real today vs. stubbed** — the shape is final and stable (it's the
contract), but several backends are foundation-phase stand-ins pending Atlas's core services
(`docs/MASTER_PLAN.md` §8, item A2):

| Member | Status today | Real behavior once wired |
|---|---|---|
| `logger` | **Real.** Backed by a NestJS `Logger` scoped `plugin:<your-id>`; `debug/info/warn/error` all work, `child()` currently returns the same logger (bindings aren't merged in yet). | Structured/pino-backed, with real binding merge. |
| `config.get()` / `getOrThrow()` | **Stubbed.** Always returns `undefined` / throws "config not available in foundation build". | Reads your declared `settings` values + persisted overrides from the DB. |
| `config.isFeatureEnabled()` | **Stubbed.** Always `false`. | Reads your declared `featureFlags` + per-environment overrides. |
| `events.emit/on/onPlatform` | **Stubbed no-ops.** Nothing is delivered. | A real scoped event bus, topics auto-namespaced to your plugin id. |
| `db` | **Always `undefined`**, even if you declared `requiredServices: ["database"]`. | A `PluginDatabase` scoped to your own Postgres schema (`schema`, `query()`), no cross-schema access. |
| `getPrincipal()` | **Always `undefined`.** No auth is wired into the core yet. | The authenticated caller for the current request-scoped context (`userId`, `roles`, `hasPermission()`), `undefined` for background/system calls same as today. |

Write your plugin against the interfaces, not the current stub behavior — `ctx.config.get<string>("greetingName")` is the correct call to make today even though it currently
returns `undefined`; it'll start returning real values with no change on your end once the
settings service lands.

---

## 7. How the core loads you (so you can debug it)

Source: [`apps/api/src/core/plugins/plugin-loader.service.ts`](../apps/api/src/core/plugins/plugin-loader.service.ts).

### 7.1 Discovery

On boot, the loader scans every immediate subdirectory of `PLUGINS_DIR` (env var, default
`plugins/` resolved from the monorepo root) for one containing a `plugin.manifest.json`. That's
the entire discovery mechanism — "drop a repo into `/plugins`, it becomes a module" — no
registration step, no config file to edit.

### 7.2 Validation and load order

1. **Every** manifest in the directory is read and validated first (`safeParseManifest`),
   independent of runtime import — a broken manifest never even attempts to load code.
2. Manifests are **topologically sorted** by `dependencies` (DFS). A missing dependency, a
   dependency cycle, or a dependency that itself failed marks your plugin `failed` with the
   specific reason (`missing dependency "X"`, `circular dependency: a -> b -> a`, `depends on
   failed plugin "X"`) — it's never silently dropped.
3. Each plugin (in resolved order) is checked against `minPlatformVersion`, then its `entry`
   module is dynamically imported, then `register()` runs.
4. Every plugin that reaches `state: "registered"` is then `enable()`d.

### 7.3 A note if you're building tooling around this (not required to just author a plugin)

Plugin entries are ESM. The loader resolves your `entry` path to an absolute `file://` URL
(`pathToFileURL`, required for correctness on Windows) and imports it through a real dynamic
`import()` that's deliberately hidden from TypeScript's CommonJS downleveling (the core itself
compiles to CommonJS; a naive `import()` there gets rewritten to `require()`, which can't load an
ESM module or a `file://` URL). You don't need to do anything about this as a plugin author —
just ship a normal ESM build (`"type": "module"`, `dist/index.js`) — but it explains why a CJS
entry silently fails to load with an unhelpful error.

### 7.4 States you'll see

`discovered → validated → registered → enabled` is the healthy path; `disabled` and `failed` are
the others. `GET /api/plugins` and `GET /api/plugins/:id` report `state`, and `error` when
`state === "failed"` — that error string is always the specific reason (bad manifest field,
version mismatch, import failure, hook throw), so start there when something doesn't load.

---

## 8. Navigation — how your `navigation` entries reach the sidebar

The portal (`apps/web`) fetches `GET /api/plugins` and, for **every loaded plugin regardless of
state**, flattens and sorts every entry across every plugin's `navigation` array by `order`
(ascending), merges it with the core's own fixed items (Dashboard, Modules, Settings, Admin), and
renders the result in the sidebar and the `Ctrl/⌘K` command palette. See
`apps/web/src/lib/nav.ts` (`buildNavGroups`) and `apps/web/src/lib/icons.ts` (icon resolution) if
you want to see exactly how.

Practical implications for you as a plugin author:

- **You don't touch the portal at all.** Adding a `navigation` entry to your manifest is
  sufficient — it appears after your plugin is rebuilt and the core restarts (or, once the API
  supports it, on the portal's next data refresh).
- Your item links to `/modules/<your-plugin-id><path>`. Until your plugin ships an actual
  federated frontend, that route renders a generic "this module doesn't have a mounted UI yet"
  placeholder rather than a 404 — expected for now, not a bug.
- Pick an `order` that doesn't try to force a position at the very top/bottom of the list — those
  bands are reserved for core platform items (see the table in §4).

---

## 9. The permission model

Source: [`packages/plugin-sdk/src/permissions.ts`](../packages/plugin-sdk/src/permissions.ts).

Permissions are **colon-scoped strings**: `<domain>:<resource>:<action>` or `<domain>:<action>`,
validated against `^[a-z0-9-]+(?::[a-z0-9-]+)+$`. The core reserves the `core:*` and `platform:*`
namespaces (`CorePermissions` — `platform:admin`, `core:plugin:manage`, `core:user:manage`,
`core:role:manage`, `core:settings:manage`, `core:audit:read`, `core:feature-flag:manage`,
`core:authenticated`). **Your plugin defines its own permissions under its own id**, e.g.
`billing:invoice:write`, and declares every one it needs in the manifest's top-level
`permissions` array — that's the complete set the core enforces least-privilege against.

Wildcard matching: holding `"billing:*"` satisfies any required `"billing:...:..."` permission;
holding `platform:admin` satisfies everything (`permissionSatisfies()` / `hasPermission()` /
`hasAllPermissions()` if you need the matching logic yourself).

Gate individual `navigation` items and `routes` with `requiresPermissions` — an array of
permission strings a caller must hold **all** of to see/call that item. (As noted in §4/§6: no
auth is wired into the running system yet, so this isn't enforced end-to-end today — declare it
correctly anyway, since it activates automatically once RBAC/auth ships, no manifest change
needed on your end.)

---

## 10. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Plugin doesn't appear in `GET /api/plugins` at all | Directory isn't directly under `PLUGINS_DIR`, or it has no `plugin.manifest.json` at its root — check the loader's boot log for "Scanning for plugins in ...". |
| `state: "failed"`, error mentions a Zod path (e.g. `id: id must be kebab-case...`) | Manifest failed schema validation. The error names the exact field. |
| `error: "requires platform >= X, running Y"` | Your `minPlatformVersion` is ahead of the running core's `PLATFORM_VERSION` (currently `0.1.0`). |
| `error: "missing dependency ..."` / `"circular dependency ..."` / `"depends on failed plugin ..."` | A problem in your `dependencies` graph — fix the named plugin/id. |
| `error: "entry failed to import: ..."` | Your `dist/index.js` doesn't exist, isn't valid ESM, or throws at module-eval time (top-level code, not inside a hook). Rebuild and check the underlying error message. |
| `error: "register() threw: ..."` / `"enable() threw: ..."` | Your hook threw. The message is your thrown error's `.message`. |
| Health shows `"down"` unexpectedly | Your `health()` threw, or exceeded `PLUGIN_HEALTH_POLL_TIMEOUT_MS` (default 5s). Check `detail` on the returned `HealthResult` / logged warning. |
| Nav item doesn't show up in the portal | Confirm your plugin actually loaded (`GET /api/plugins/<id>`) — items are only aggregated from plugins present in that response. Also double-check `path` starts with `/`. |
| Icon shows the generic fallback glyph | The `icon` name isn't in the portal's curated Lucide subset (`apps/web/src/lib/icons.ts`) — casing/format isn't the issue (that's normalized), the name itself just isn't recognized yet. Not an error; ask the portal owner to add it, or pick a covered name. |

---

## 11. What's intentionally not here yet

So you don't spend time working around gaps that are just unbuilt, not hidden:

- No persisted per-plugin enable/disable (everything that registers is auto-enabled on every
  boot).
- No admin API to call `install`/`uninstall`/`disable` — those hooks exist in the contract but
  have no caller yet.
- `PluginContext.config`, `.events`, and `.db` are stubs (§6) — Atlas's settings/events/database
  core services aren't wired in yet.
- `routes` in the manifest is declarative documentation today, not an auto-mounting mechanism —
  you still register real backend routes yourself.
- No marketplace / remote install — `/plugins` is filesystem-only.

All of the above are on the platform roadmap (`docs/MASTER_PLAN.md` §6–§7) — this guide will be
updated as they land.
