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
