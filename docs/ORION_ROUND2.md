# Orion — Round 2 results (portal UX / DX)

> Scope: §8 "🌌 Orion — ROUND 2" tasks OR2-1 … OR2-4. All work strictly inside
> `apps/web/**` + `docs/*` (never `docs/MASTER_PLAN.md`). No `git`, no
> `pnpm install`/`pnpm add`, no `shadcn` CLI (web deps already installed).
> Build/typecheck run via `./node_modules/.bin/turbo` because `pnpm` is broken
> on this Windows host (mangled corepack path — see MASTER_PLAN §8 Atlas note).

## Design approach
Applied `emil-design-eng` + `impeccable` (Operate mode — admin console): neutral
palette, `accent` brand color, focus-visible rings on every interactive element,
subtle ease-out transitions only (no keyboard-driven animation), health encoded
as a calm pulsing dot for `ok` and steady dots for `degraded`/`down`. Tabs use
real `role="tab"` + roving-tabindex keyboard nav (no fake ARIA). Mobile layouts
inherit the existing responsive utilities (`md:` breakpoints, off-canvas drawer).

## Files changed (all under `apps/web/**`)

New:
- `src/lib/use-live.ts` — `useLivePlugins()` / `useLivePluginDetail()` polling
  hooks (15s interval) + `formatAgo()`. Degrade gracefully: keep last good
  snapshot, set `error` only on first load failure, never throw mid-poll.
- `src/components/ui/tabs.tsx` — accessible Tabs primitive (ARIA + keyboard nav).
- `src/components/modules/plugin-detail-view.tsx` — OR2-1 full-manifest renderer
  (Overview / Access / Behavior / Tools tabs, live health badge, graceful error).
- `src/components/modules/modules-live-view.tsx` — OR2-2 wrapper polling
  `/api/plugins` and feeding `ModulesView`.
- `src/components/dashboard/live-dashboard.tsx` — OR2-2 live dashboard
  (platform summary, recent modules linked to detail pages).
- `src/components/admin/admin-console.tsx` — OR2-3 platform summary from
  `/api/health`, filterable (state + health + search) plugins table with per-row
  detail links, disabled "coming soon" enable/disable (no invented endpoints).

Edited:
- `src/lib/types.ts` — added `PluginDetail`, `PlatformHealth`, `PluginTool`,
  `PluginRoute`, `PluginFeatureFlag`, `PluginSetting`, `PluginJob`, and
  `toolCount` on `PluginSummary` (mirrors `packages/plugin-sdk/src/manifest.ts` +
  `PluginsController` shapes, kept in sync by hand; portal does not build against
  the SDK).
- `src/lib/api.ts` — added `getPluginDetail(id)` and `getHealth()`.
- `src/components/modules/plugin-state.tsx` — added `HealthDot` (decorative live
  status indicator).
- `src/app/modules/[pluginId]/[[...slug]]/page.tsx` — OR2-1 rewrite: renders full
  manifest via `PluginDetailView`; friendly "Module unavailable" state when the
  core returns nothing (404 or down) instead of `notFound()`.
- `src/app/modules/page.tsx` — uses `ModulesLiveView` (SSR initial + live poll).
- `src/app/page.tsx` — uses `LiveDashboard` (SSR initial + live poll).
- `src/app/admin/page.tsx` — OR2-3 rewrite: fetches `/api/health` + `/api/plugins`
  and renders `AdminConsole`.
- `src/components/shell/command-palette.tsx` — OR2-4: ⌘K now jumps to any
  plugin's detail page (`<name> · overview`); added `Boxes` icon + `plugins` prop.
- `src/components/shell/app-shell.tsx` — threaded `plugins` prop to palette.
- `src/app/layout.tsx` — passed `plugins` (id+name) into `AppShell`.

## Verification (real runs)
- **Build:** `./node_modules/.bin/turbo run build --filter=@constellation/web`
  → **1 successful**. All 7 routes compile:
  `/`, `/admin`, `/modules`, `/modules/[pluginId]/[[...slug]]`, `/settings`,
  `/_not-found`. (Two type errors in the Tabs primitive were hit and fixed:
  `tabs[nextIdx]` undefined guard, and `cloneElement` ref typing → replaced with
  DOM `querySelectorAll` focus management.)
- **Typecheck:** `./node_modules/.bin/turbo run typecheck --filter=@constellation/web`
  → **1 successful** (`tsc --noEmit` clean).
- **Live degradation (API down):** ran `next dev` with `NEXT_PUBLIC_API_URL`
  pointed at a dead port (9999). All routes returned **200** with friendly empty
  states — no 500s, no runtime errors in the dev log:
  - `/` → "Modules loaded 0 / No modules loaded yet" + "Live ·" indicator
  - `/modules` → empty-state + "Live ·"
  - `/admin` → "Platform status / Plugin registry" with unknown health
  - `/modules/hello-world` → "Module unavailable / Back to Modules" card
  - `/modules/does-not-exist` → 200 (handled, not crashed)

## What was NOT done (by design, per scope)
- No `/api/plugins/:id/enable|disable` endpoints invented. The admin enable/disable
  buttons render disabled with a "coming soon" tooltip; they wire to real endpoints
  when the admin + RBAC layer (P2) lands.
- No changes to `apps/api/**`, `packages/**`, `plugins/**`, Docker/CI, or
  `docs/MASTER_PLAN.md`. The `plugins/browser-use` lockfile warning during turbo
  runs is Nova's round-2 work, outside Orion's ownership — untouched.
- Nothing committed/pushed (per standing rule).

---

## Round 3 — P3/P4 portal UI (federated tools, Tools tab + invoke, session polish, admin depth)

> Scope: P3 portal federation (federated tool tiles from `modules.yaml`) + P4
> (agent-plane Tools tab + invoke form, session/login polish, admin depth). All
> work inside `apps/web/**` + `docs/*` (never `docs/MASTER_PLAN.md`). No `git`,
> no `pnpm install`/`pnpm add`, no `shadcn` CLI (web deps already installed).
> Build/typecheck via `./node_modules/.bin/turbo` (pnpm is broken on this host).

### Assumed / documented-but-not-yet-built backend contracts (degraded gracefully)
These endpoints/features do not exist in `apps/api` yet (confirmed by reading the
controller + grepping the api tree). The UI is built to the documented shape and
degrades when they 404 / are absent — **no endpoints were invented**:
- `POST /api/plugins/:id/tools/:toolName/invoke` — the controller's `toDetail()`
  explicitly notes "invoking a tool is a separate, permission-checked route (later
  round)". The Tools-tab invoke form POSTs here; on 404 it flips to a disabled
  "coming soon" state. Permission is enforced client-side against the tool's
  declared `permission` (server remains the real boundary, later).
- `modules.yaml` federated catalog — no backend endpoint exists yet. The portal
  reads it from `NEXT_PUBLIC_FEDERATED_MODULES_URL` (remote) or
  `apps/web/public/modules.yaml` (local). Both are best-effort; an absent/invalid
  file yields an empty catalog rather than throwing. Parsed with a small
  dependency-free YAML reader scoped to the `tools:` list (js-yaml is NOT
  installed and was deliberately not added — the rules forbid new deps).

### Files added (all under `apps/web/**`)
- `src/lib/federated-tools.ts` — types (`FederatedTool`, `FederatedCatalog`,
  `FederatedToolStatus`) + a scoped, dependency-free YAML parser for the
  `tools:` block (tolerates missing/extra keys, block scalars, quoted values).
- `src/lib/federated-api.ts` — `getFederatedTools()` (remote→local fallback,
  never throws; returns `source: "none"` when unconfigured).
- `src/components/modules/federated-tool-tile.tsx` — `FederatedToolTile` (card;
  opens `url` in a new tab when live/openable, else a non-interactive placeholder).
- `src/app/tools/page.tsx` — new `/tools` route: grouped federated catalog with
  empty/degraded states + source footnote.
- `apps/web/public/modules.yaml` — sample catalog (Grafana/Langflow/Open WebUI/
  Coolify/OpenHands/Graphify) so the surface is populated by default.
- `src/components/modules/plugin-tools-panel.tsx` — `PluginToolsPanel`: renders
  each declared agent-plane tool with a JSON `args` textarea + Invoke button wired
  to the documented invoke route; degrades to "coming soon" on 404, shows
  permission gating, renders the result/error.
- `src/components/shell/session-guard.tsx` — `SessionGuard`: polls `/api/auth/me`
  every 60s; on 401/403 logs out + redirects to `/login`; on unreachable shows a
  non-blocking banner and flags `apiUnreachable` (no forced logout).

### Files edited (all under `apps/web/**`)
- `src/lib/icons.ts` — added `MessagesSquare` + `Share2` (used by `modules.yaml`).
- `src/lib/nav.ts` — added a "Tools" core platform nav entry (`/tools`, `Boxes`).
- `src/lib/tool-invoke.ts` — `invokeTool()` + `canInvokeTool()` (invoke contract).
- `src/components/modules/plugin-detail-view.tsx` — replaced the inline Tools tab
  with `<PluginToolsPanel>`; added `defaultTab` prop (honors `?tab=tools`).
- `src/components/admin/admin-console.tsx` — added a "Federated tools" summary
  card to `PlatformSummary` + a `FederationReadiness` section (source + live
  status counts); accepts a `federated` prop.
- `src/app/admin/page.tsx` — fetches `getFederatedTools()` and passes to console.
- `src/components/auth/auth-provider.tsx` — exposed `setApiUnreachable` on context.
- `src/components/providers.tsx` — wrapped children in `SessionGuard`.
- `src/app/login/page.tsx` — inline "session ended / unreachable" hint when bounced
  with a `?redirect` after expiry.
- `src/app/modules/[pluginId]/[[...slug]]/page.tsx` — reads `searchParams.tab` and
  passes `defaultTab` (supports the ⌘K "plugin · tools" jump).
- `src/components/shell/command-palette.tsx` — ⌘K now jumps to any plugin's Tools
  tab (`<name> · tools`) in addition to its overview.
- `.env.example` — documented `NEXT_PUBLIC_FEDERATED_MODULES_URL`.

### Verification (real runs)
- **Build:** `./node_modules/.bin/turbo run build --filter=@constellation/web`
  → **1 successful**. New route `/tools` compiles alongside the existing routes.
- **Typecheck:** `./node_modules/.bin/turbo run typecheck --filter=@constellation/web`
  → **1 successful** (`tsc --noEmit` clean).
- **Live degradation (API down):** started `next dev` with `NEXT_PUBLIC_API_URL`
  pointed at a dead port. All routes returned **200** with friendly empty states —
  no 500s: `/tools` → empty catalog card; `/admin` → platform summary with
  "Federated tools: —" + "Not configured"; `/modules/<id>` → "Module unavailable";
  the Tools tab form renders "Coming soon" because the invoke route 404s.
- **Live with API up:** `/tools` renders the 6 sample tiles grouped by category,
  links open in a new tab; `/admin` shows `Federated tools: N/M live`; ⌘K lists
  each plugin's `· tools` jump.

### What was NOT done (by design)
- No `POST /api/plugins/:id/tools/:toolName/invoke` endpoint was created (Atlas/
  Nova lane, later round) — the form degrades to "coming soon" on 404.
- No `GET /api/federated-tools` endpoint — catalog is read from `modules.yaml`
  (remote or local). The remote URL is an accepted seam for a future overlay.
- No `git`/install/CI changes. Nothing committed or pushed (standing rule).
