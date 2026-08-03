# Platform hardening (v0.6) — LIVE-PROOF evidence (Polaris, 2026-08-03)

Stack: real local infra (postgres:5432, redis:6380, api:4001).

## 1. httpOnly cookie — login sets httpOnly SameSite cookie
   POST /api/auth/login (admin) response header:
     Set-Cookie: constellation_token=eyJhbG...; Path=/; HttpOnly; SameSite=lax
   The access token is ALSO returned in the login body (backward compat for
   bearer clients). The cookie is httpOnly -> client JS cannot read the token
   (closes the localStorage XSS caveat documented in auth-storage.ts).

## 2. Cookie-authenticated request (no Authorization header, cookie only)
   GET /api/auth/me with ONLY the constellation_token cookie:
     email: admin@constellation.local, permissions: ['platform:admin']
   The global JwtAuthGuard correctly reads the token from the cookie when no
   bearer header is present. Bearer flow untouched.

## 3. Viewer user seed (enables the live 403 path)
   POST /api/auth/login { viewer@constellation.local / changeme }:
     roles: ['viewer'], permissions: ['core:authenticated']  (NO platform:admin)
   viewer -> GET /api/audit (admin-only): HTTP 403   <- the live non-admin 403 path
   viewer -> GET /api/engine/schedules (any-authed): HTTP 200 (no over-blocking)

## 4. Per-plugin schema bootstrap
   Wired into plugin-loader.loadOne + plugin-lifecycle.enable via
   PluginContextFactory.schemaBootstrap(manifest); PrismaService.bootstrapSchema
   issues CREATE SCHEMA IF NOT EXISTS "<schema>" with a defensive identifier
   check (rejects non-identifier names) and graceful no-DB degrade.
   Verified by gates + typecheck (creation of a real per-plugin schema requires
   a plugin that declares a DB schema dependency; none of the in-repo plugins
   declare one, so this is logic-verified, not live-created).

## Gates: lint/build/typecheck/test 20/20 (monorepo), api 402 tests (repo 519).
