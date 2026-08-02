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
>
> **⚠️ RECONCILED TO REAL CONTRACTS (2026-08-02, Orion — UNCOMMITTED, pending
> orchestrator merge).** The original Round 3 plan below was written *before*
> the orchestrator's P3+P4 slice was committed (git `a07dd25`), which actually
> built the backend endpoints I had assumed were absent. The portal code was
> rewritten to consume those real contracts instead of inventing parallel ones:
> - Federation: the portal now calls **`GET /api/federation/modules`** (Bearer-auth;
>   returns `FederatedModuleDto[]` from the API's `config/modules.yaml`) — it does
>   **NOT** parse `modules.yaml` itself. The old `src/lib/federated-tools.ts` YAML
>   parser, `src/lib/federated-api.ts`, and `apps/web/public/modules.yaml` were
>   **deleted**; replaced by `src/lib/federated.ts` (`fetchFederatedModules`).
> - Tool invoke: the form now POSTs to **`POST /api/plugins/:id/invoke`** with
>   body `{ tool, args }` (two-layer authz: route `core:plugin:manage` + the tool's
>   own `permission`; returns 200 with a ToolResult envelope even on tool failure).
>   The assumed `POST /api/plugins/:id/tools/:toolName/invoke` endpoint never
>   existed — corrected to the real one.
> - `NEXT_PUBLIC_FEDERATED_MODULES_URL` was removed from `.env.example` (no longer used).
> The "Assumed / documented-but-not-yet-built backend contracts" subsection below
> is therefore **superseded**; keep it only as a historical note. See the
> per-file list further down for the reconciled file set.

### Assumed / documented-but-not-yet-built backend contracts (SUPERSEDED — see addendum above)
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

### Files added (all under `apps/web/**`) — RECONCILED SET
- `src/lib/federated.ts` — `fetchFederatedModules(token)` (client fetch of
  `GET /api/federation/modules`, Bearer-auth, degrades to `[]`; filters
  `display:"hidden"`), the `FederatedTool` view type, and `canOpenModule()`.
- `src/app/tools/page.tsx` — new `/tools` route (client component): grouped
  federated catalog fetched via `useAuth().token`, empty/degraded states.
- `src/components/modules/federated-tool-tile.tsx` — `FederatedToolTile` (card;
  links to the module's proxied `path`; SSO/embeddable/permission badges; locked
  state when the caller lacks `requiresPermissions`).
- `src/components/modules/plugin-tools-panel.tsx` — `PluginToolsPanel`: renders
  each declared agent-plane tool with a JSON `args` textarea + Invoke button wired
  to `POST /api/plugins/:id/invoke`; shows the result/error envelope, permission
  gating, and unreachable/forbidden states.
- `src/components/shell/session-guard.tsx` — `SessionGuard`: polls `/api/auth/me`
  every 60s; on 401/403 logs out + redirects to `/login`; on unreachable shows a
  non-blocking banner and flags `apiUnreachable`.

### Files deleted (superseded by the reconciled design)
- `src/lib/federated-tools.ts` — hand-rolled YAML parser + `FederatedCatalog`
  (the portal no longer parses `modules.yaml`).
- `src/lib/federated-api.ts` — local/remote YAML loader (replaced by API fetch).
- `apps/web/public/modules.yaml` — sample catalog (source of truth is now the
  API's `config/modules.yaml`).

### Files edited (all under `apps/web/**`)
- `src/lib/icons.ts` — added icons used by federation tiles (`Boxes`, `Share2`, etc.).
- `src/lib/nav.ts` — added a "Tools" core platform nav entry (`/tools`, `Boxes`).
- `src/lib/tool-invoke.ts` — `invokeTool()` + `canInvokeTool()` rewritten to the
  real `POST /api/plugins/:id/invoke` contract (was assumed `:tools/:toolName/invoke`).
- `src/components/modules/plugin-detail-view.tsx` — replaced the inline Tools tab
  with `<PluginToolsPanel>`; added `defaultTab` prop (honors `?tab=tools`).
- `src/components/admin/admin-console.tsx` — `PlatformSummary` "Federated tools"
  count now comes from the live catalog; `FederationReadiness` shows module/SSO/
  embeddable/permission-gated counts (fetched client-side via `useAuth().token`).
- `src/app/admin/page.tsx` — no longer passes a `federated` prop; the catalog is
  fetched client-side inside `AdminConsole`.
- `src/components/auth/auth-provider.tsx` — exposed `setApiUnreachable` on context.
- `src/components/providers.tsx` — wrapped children in `SessionGuard`.
- `src/app/login/page.tsx` — inline "session ended / unreachable" hint when bounced
  with a `?redirect` after expiry.
- `src/app/modules/[pluginId]/[[...slug]]/page.tsx` — reads `searchParams.tab` and
  passes `defaultTab` (supports the ⌘K "plugin · tools" jump).
- `src/components/shell/command-palette.tsx` — ⌘K now jumps to any plugin's Tools
  tab (`<name> · tools`) in addition to its overview.
- `.env.example` — removed `NEXT_PUBLIC_FEDERATED_MODULES_URL`; federation is served
  by the API (`GET /api/federation/modules`), no extra portal env needed.

### Verification (real runs)
- **Build:** `./node_modules/.bin/turbo run build --filter=@constellation/web`
  → **1 successful** (clean `.next` required on this Windows host; a stale
  `.next` from a killed `next dev` causes an intermittent `ENOENT` on a
  `*-manifest.json` at the trace step — `rm -rf apps/web/.next` clears it). New
  route `/tools` compiles alongside the existing routes.
- **Typecheck:** `./node_modules/.bin/turbo run typecheck --filter=@constellation/web`
  → **1 successful** (`tsc --noEmit` clean).
- **Live with API up (a07dd25):** booted the API (`API_PORT=4001 node dist/main.js`,
  no DB) + `next dev` pointed at it. Confirmed:
  - `/tools` renders the federated tiles from `GET /api/federation/modules`
    (Grafana/Langflow/Open WebUI/Coolify via `config/modules.yaml`), grouped by
    category, each linking to its proxied `path`.
  - `/modules/browser-use?tab=tools` renders the Tools tab with the
    `browser.navigate`/`act`/`extract` tools + Invoke form.
  - `/admin` "Federated tools" count + `FederationReadiness` counts come from the
    live catalog (fetched client-side with the bearer token).
- **Live degradation (API down):** `next dev` pointed at a dead port. All routes
  returned **200** with friendly empty states — no 500s: `/tools` → empty catalog
  card (or "couldn't reach the registry" when a token is present); `/admin` →
  platform summary with "Federated tools: —"; `/modules/<id>` → "Module unavailable";
  the Tools-tab Invoke form shows a clear error (unreachable/forbidden) instead of
  a false "Coming soon", because the real `POST /api/plugins/:id/invoke` route now
  exists and is what the form targets.

### What was NOT done (by design)
- No backend endpoints were created or modified — the portal consumes the
  orchestrator's `a07dd25` contracts (`GET /api/federation/modules`,
  `POST /api/plugins/:id/invoke`). Invoking a tool still requires a plugin whose
  runtime implements `invokeTool()` (browser-use/graphify declare tools but the
  reference runtime may not implement the seam yet — the server returns a clear
  200 `{ ok:false }` envelope in that case, which the UI surfaces as an error).
- No SSO round-trip / reverse-proxy embedding proven in the portal (the API's
  `config/modules.yaml` + `docker-compose.federation.yml` exist but are unrun).
- No `git`/install/CI changes. Nothing committed or pushed (standing rule); the
  reconciled portal code is **UNCOMMITTED** pending the orchestrator's merge.
