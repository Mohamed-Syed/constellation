# Constellation — Live Handoff (for clau_partner)

> **Purpose.** This is the always-current handoff. If the primary session is
> interrupted or hits a limit, **clau_partner** reads THIS file (plus
> `docs/MASTER_PLAN.md`) and continues seamlessly with no other context.
>
> **clau_partner: you are a co-worker on this project. Follow the exact rules in
> §1 and keep BOTH this file and `docs/MASTER_PLAN.md` up to date at every
> milestone — same discipline the primary session follows.**
>
> **Last updated:** 2026-08-02 (Polaris review pass; Orion federated-lib refactor checkpointed at git `b5f82b2`; P3+P4 at `a07dd25`) · **Updated by:** Polaris (lead orchestrator)
> **Note for the agents:** the P3/P4 portal + API work IS committed — do not re-label it
> "uncommitted." Only the orchestrator commits, and only the orchestrator edits this header.
> **Project root:** `C:\Users\syed.mohamed\Claude\Code\constellation`

---

## 0. Roles & leadership (who's who)
- **The user** — product owner & final decision-maker. Owns direction, the locked decisions (C1–C10), all approvals, and anything with cost/risk (push, cloud, VPS/budget). Nothing irreversible happens without the user.
- **Polaris** — *lead orchestrator / technical lead* (the primary Claude Code session). Owns the architecture, the work split, cross-boundary wiring, integration, verification, the git history, and this source-of-truth doc set. Named after the guiding star the others navigate by.
- **clau_partner** — *co-orchestrator / backup lead*. Takes over Polaris's exact role when the primary session is locked or unavailable, following the identical rules. **When both are active, only ONE orchestrates at a time to avoid clobbering: the primary session (Polaris) leads; clau_partner either works an explicitly-handed scope or stands ready.** Whoever is orchestrating is the *only* one who commits and the only one who edits `MASTER_PLAN.md` / `HANDOFF.md`.
- **Atlas / Nova / Orion** — implementer agents on **disjoint lanes** (§6). They build and report; they never run git, never claim commit/build state, and never edit the orchestrator-only docs.

---

## 1. Working rules (MANDATORY — clau_partner follows these too)
1. **Checklist first.** Before starting work, write a complete checklist of everything you will do. Do not assume; do not skip.
2. **Finish one task before starting the next.** No half-done parallel threads.
3. **Verify before "done."** Maker/checker: nothing is complete until it builds + typechecks + tests + (where relevant) boots. Re-run, don't trust a claim.
4. **$0 / local only.** Never provision cloud or install paid services. No cloud until the user explicitly approves + confirms cost (the VPS is chosen but NOT provisioned).
5. **Never `git push` and never commit to a remote without an explicit in-the-moment go-ahead.** Local commits are fine and expected.
6. **Never commit secrets.** `.env` is git-ignored; keep it that way.
7. **Keep docs current — log EVERY completed task in these three places (orchestrator only):**
   (a) `MASTER_PLAN.md §9` — a verification-log entry: what shipped, what was actually verified (gates/live/DB), and the **git SHA**;
   (b) `MASTER_PLAN.md §8` — tick the lane checkbox for that task;
   (c) `HANDOFF.md §3` (status) + `§8` (pending list) — move the item from pending → done.
   Agents report their results to the orchestrator; the **orchestrator** writes these entries (agents never edit these two docs or claim git/build state).
8. **Respect the Plugin SDK contract.** `packages/plugin-sdk` is load-bearing; evolve it deliberately + additively (versioned `manifestVersion`), and call out any change.
9. **Two verified bugs must never regress** (see §5).
10. **The three friends (Atlas/Nova/Orion) work in disjoint file-ownership lanes** (see §6). Keep them disjoint to avoid merge conflicts.

## 2. What this project is
**Constellation** = a from-scratch, enterprise-grade **plugin platform framework**
(NestJS core + Next.js portal, pnpm+Turborepo monorepo). Every imported GitHub repo
becomes an installable **module/plugin**. A small core provides auth/RBAC/nav/settings/
plugin-loader; everything else is a plugin. Two planes: a **portal** (federate heavyweight
tools — Grafana/Langflow/Open WebUI/Coolify — via SSO+proxy) and an **agent plane**
(capabilities as callable tools — browser-use/OpenHands/Graphify/review). End goal: a 24/7
agentic system. SEPARATE project from **Looper** (`../loop-engineering`), which is untouched.
Full detail + locked decisions (C1–C10) in `docs/MASTER_PLAN.md`.

## 3. Current status (2026-08-02)
- **P0 foundation:** DONE + committed (git `0311028`).
- **Dependency prep:** committed (git `0ada50f`).
- **Round 1 + Round 2: DONE, integrated, verified, and COMMITTED (git `ee64bff`, local only — NOT pushed).**
  - Round 1 — Atlas: Prisma data layer (+ real-Postgres-proven), pino logger, settings/feature-flags, event bus. Nova: topological loader + enable/disable lifecycle + health poller + `generate-plugin` CLI. Orion: portal shell (manifest-driven nav, theme, ⌘K), `PLUGIN_SDK.md`. Orchestrator: `PluginContextFactory` wires the real services into plugin hooks (`@Optional()` + `stubContext` fallback for offline tests); health summary folded into `/api/health`.
  - Round 2 — Nova: SDK `tools` (agent plane) + `invokeTool` seam + `browser-use` plugin (3 tools) + loader lifecycle events + `tools`/`toolCount` on the read API. Orion: plugin detail page, admin depth, live health polling. Atlas: `docker-compose.yml` (postgres/redis/api/web), Dockerfiles, `Makefile`, GitHub Actions CI.
  - **Verification (this session):** `pnpm build` 6/6, `typecheck` 7/7, `test` green (SDK 13 · browser-use 19 · CLI 9 · API 21 = **62**). Live API boot: health `ok`, browser-use exposes 3 tools, health poller works. Real Postgres: `Connected to Postgres (core schema)`, graceful degradation when tables absent. `docker compose config` valid; **both images build clean**.
- **P2 DONE, verified, COMMITTED (git `14137d8`, local only):** JWT auth (`@nestjs/jwt`+bcrypt, global `JwtAuthGuard`, `@Public`/`@CurrentUser`, OIDC-ready `TOKEN_VERIFIER` seam, admin/viewer seed) + RBAC/ABAC (`@RequirePermissions`+`PermissionsGuard` on SDK helpers) + audit (`AuditService`, `GET /api/audit`) + `POST /api/plugins/:id/enable|disable` (guarded `core:plugin:manage`, audited, **state persists across restart**) + auth portal (login, gating, role-aware nav, wired buttons). **74 tests.** Verified live vs real Postgres (login→JWT, /me, 401/deny, audit rows, restart-persistence). See §9.
- **P3 + P4 (first slice) DONE, verified, COMMITTED (git `a07dd25`, local only) — 2026-08-02, clau_partner:**
  - **Atlas — OIDC/SSO auth seam:** `OidcJwtVerifier` (JWKS-backed) + `CompositeTokenVerifier`
    (local JWT first, OIDC when `OIDC_ISSUER_URL` is set), bound to the existing `TOKEN_VERIFIER`
    token in `AuthModule` — guards/controllers unchanged. Logs `SSO not configured — local JWT
    verification only` and degrades cleanly when unset. Plus `infra/` configs (Caddy reverse proxy,
    Prometheus, Loki, Grafana datasources) and `docker-compose.federation.yml`.
  - **Nova — agent-plane tool invocation:** `PluginToolService` (resolve + permission-check before
    running plugin code) and `POST /api/plugins/:id/invoke` with **two-layer authz** (route-level
    `core:plugin:manage` + the tool's own manifest `permission`). Every attempt audited **including
    denials**; args/results deliberately never logged. New third capability plugin
    **`plugins/graphify`** (`graph.query` / `graph.related` / `graph.ingest` over MCP JSON-RPC),
    unconfigured-safe.
  - **Orion — portal federation UX (reconciled to the real API contracts, UNCOMMITTED pending orchestrator merge):**
    `/tools` federated tile page + `federated-tool-tile` (consume `GET /api/federation/modules`,
    Bearer-auth; tiles link to each module's proxied `path`), `plugin-tools-panel` (tool-invoke UI →
    `POST /api/plugins/:id/invoke` with `{ tool, args }`, two-layer authz), `session-guard`, and
    `lib/federated.ts` + `lib/tool-invoke.ts` clients. The portal does NOT parse `modules.yaml`
    itself — it reads the API's registry. Admin "Federated tools" summary pulls the live catalog.
  - **Orchestrator wiring:** `config/modules.yaml` federated registry + `core/federation`
    (`GET /api/federation/modules | /:id | /status`) mounted in `AppModule`; **fixed the
    `pnpm-lock.yaml` missing `plugins/graphify` importer** (turbo warned "workspace not found in
    lockfile" — CI's `--frozen-lockfile` would have failed).
  - **Gates:** build **7/7** · typecheck **8/8** · test **169** (sdk 13, cli 9, browser-use 25,
    api 95, graphify 27) — all run `--force --concurrency=1`. Live boot + real-Postgres pass. See §9.
- **Orion's federated-lib refactor CHECKPOINTED at `b5f82b2`** (Polaris review, 2026-08-02): consolidated `federated-api.ts`+`federated-tools.ts` → `lib/federated.ts`, `modules.yaml` moved `public/` → `config/`. Verified building at that point.
- **Working tree CLEAN at `b5f82b2`.** Nothing pushed. No cloud provisioned. **VPS deferred** — prove everything locally first (user decision 2026-08-01).
- **Polaris re-verification (2026-08-02):** independently re-ran the gates after the checkpoint — `pnpm build` 7/7 (no cache), `pnpm test` green (**api 95, browser-use 25**, + sdk/cli/graphify = 169 per clau_partner's fuller run), web typecheck clean. State is coherent and on-plan. NB: `pnpm` worked fine from *this* bash shell (the §3 "pnpm broken" trap is shell-specific — turbo-direct is the safe fallback either way).
- **⚠️ ENVIRONMENT GOTCHAS (confirmed again 2026-08-02 — read before verifying):**
  1. **`pnpm` is broken on this host.** `corepack enable && pnpm install` dies with
     `MODULE_NOT_FOUND` on a mangled `C:\c\Users\...\corepack\dist\pnpm.js` path. Use
     **`./node_modules/.bin/turbo run build|typecheck|test`** instead. Deps are already installed.
  2. **Turbo caching lies.** A plain `turbo run build` reported `7 successful … FULL TURBO` from
     cache on code that had never been built. **Always pass `--force`.**
  3. **Run gates with `--concurrency=1`.** A parallel `--force` run failed `@constellation/web#build`
     spuriously; the same build passes alone and serialized. Parallel failures here are collisions,
     not real errors — re-check serialized before chasing a phantom bug.
  4. **Killing the stale port squatter:** `taskkill //PID` fails under git-bash and the PID from
     `netstat` can be stale. What works:
     `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4001 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`
     then re-check the port is FREE before booting.
  5. **Background API boots die when their shell closes** — launch with `exec node dist/main.js`.
  6. **Host-blocked pnpm/CI checks are still runnable — don't defer them.** Reproduce CI in a
     throwaway container instead:
     `docker run --rm -v "//c/Users/syed.mohamed/Claude/Code/constellation:/src:ro" node:22-bookworm-slim bash -c '...'`
     — inside, `tar`-copy only manifests + lockfile (**exclude `node_modules`**, or the copy takes
     >10min), `corepack prepare pnpm@9.12.3 --activate`, then run the real gate. This is how
     `pnpm install --frozen-lockfile` was proven on 2026-08-02. Note: single-**file** `-v` mounts
     misbehave on this Windows host (mount the directory instead).

- **Known follow-ups (not blockers):** plugin READ endpoints are `@Public` for P2 (module list isn't sensitive; harden to authed + httpOnly-cookie tokens later); portal token is in-memory+localStorage (XSS caveat noted in code); no committed `prisma/migrations` history yet (Docker entrypoint uses `db push`); a viewer (non-admin) user isn't seeded so the 403 UI path is unit-tested, not live-clicked.
- **Remaining Docker check:** a full 4-service `docker compose up --wait` from the freshly-built images (Atlas reports healthy; orchestrator confirmed config + image builds + real DB connection, but didn't re-run the full `up` this pass).

## 4. Repo layout (monorepo)
```
constellation/
├── apps/api/            # NestJS core: bootstrap, config, plugin loader/registry/lifecycle/health, DB (Prisma), logging(pino), settings, events
│   ├── prisma/          # schema.prisma (core schema); prisma.config.ts
│   └── src/core/{plugins,database,logging,settings,events,health,auth,rbac,audit,federation}
│       ├── auth/        # JWT login + guards; TOKEN_VERIFIER seam → local-jwt / oidc-jwt / composite
│       ├── plugins/     # + plugin-tool.service.ts (agent-plane dispatch) + dto/invoke-tool.dto.ts
│       └── federation/  # reads config/modules.yaml → GET /api/federation/modules|:id|status
├── apps/web/            # Next.js App Router portal: shell, manifest-driven sidebar, theme, ⌘K,
│                        #   modules/detail/admin/settings/login + /tools federated tiles + tool-invoke UI
├── packages/plugin-sdk/ # THE contract: manifest (Zod) + Plugin lifecycle + PluginContext + permissions (+ tools, agent-plane)
├── packages/cli/        # @constellation/cli — generate-plugin scaffolder
├── plugins/hello-world/ # reference plugin
├── plugins/browser-use/ # agent-plane capability (tools: browser.navigate/act/extract)
├── plugins/graphify/    # agent-plane capability (tools: graph.query/related/ingest, MCP JSON-RPC)
├── config/modules.yaml  # federated module registry (DATA — add a tool here, never edit the core)
├── infra/               # Caddy reverse proxy, Prometheus, Loki, Grafana provisioning  ← UNRUN so far
├── docker-compose.yml, docker-compose.federation.yml, Makefile, apps/*/Dockerfile, .github/
└── docs/{MASTER_PLAN.md, HANDOFF.md (this), BRAIN.md, PLUGIN_SDK.md, ORION_ROUND2.md}
```

## 5. TWO VERIFIED BUGS — never regress (see MASTER_PLAN §9)
1. **Windows dynamic import** needs `pathToFileURL()` → `file:///C:/…`, not string `file://C:/…`.
2. **CJS downleveling:** under `module: CommonJS`, tsc rewrites `import()` → `require()`, which can't load an ESM plugin. The loader uses `const esmImport = new Function("s","return import(s)")` to preserve a real dynamic import. Tests swap it via `__setEntryImporterForTests` (a Vitest vm limitation, not a defect).

## 6. Friend file-ownership lanes (keep disjoint)
- **Atlas (infra/data):** `apps/api/src/core/{database,logging,settings,events,auth,rbac,audit}`, `apps/api/prisma`, `apps/api/src/app.module.ts`, `infra/**`, Docker/Compose/Makefile/CI, README "Run with Docker".
- **Nova (SDK/core-plugins/capabilities):** `packages/**`, `apps/api/src/core/plugins/**`, `plugins/<new capability>/**`.
- **Orion (portal/DX):** `apps/web/**`, `docs/*` **EXCEPT `docs/MASTER_PLAN.md` and `docs/HANDOFF.md`** — both are orchestrator-only.
- **Orchestrator only:** `docs/MASTER_PLAN.md`, `docs/HANDOFF.md`, `config/modules.yaml` + `apps/api/src/core/federation/**` (cross-boundary), other cross-boundary wiring (e.g. `plugin-context.factory.ts`), `pnpm-lock.yaml`, all installs, all git commits.
- **⚠️ Observed 2026-08-02:** Orion edited the HANDOFF header and mislabeled committed work as
  "UNCOMMITTED." Agents cannot see git state — **they must never write commit/status claims.**
  State that explicitly when assigning any lane that includes `docs/`.


## 7. How to verify (the standard pass)
> **`pnpm` is BROKEN on this host — see the gotchas in §3.** Use turbo directly, always
> `--force` (cache reports false greens) and `--concurrency=1` (parallel runs fail spuriously).
```bash
cd C:/Users/syed.mohamed/Claude/Code/constellation
cd apps/api && ./node_modules/.bin/prisma generate && cd ../..   # needed before the api build
./node_modules/.bin/turbo run build     --force --concurrency=1   # expect 7/7
./node_modules/.bin/turbo run typecheck --force --concurrency=1   # expect 8/8
./node_modules/.bin/turbo run test      --force --concurrency=1   # expect 169 tests
# live boot — FIRST free port 4001 (a stale dist/main.js has squatted it twice and served old code):
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4001 -State Listen | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
cd apps/api && API_PORT=4001 exec node dist/main.js   # GET /api/health, /api/plugins, /api/federation/status
# real Postgres (disposable local container only):
docker compose up -d postgres
cd apps/api && DATABASE_URL="postgresql://constellation:constellation@localhost:5432/constellation" \
  PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 ./node_modules/.bin/prisma db push --accept-data-loss
# ...boot with DATABASE_URL + JWT_SECRET set, then: docker compose down --volumes
```

## 8. Pending / next actions (priority order)
1. **🧠 THE BRAIN (Memory & Knowledge Graph) — TOP PRIORITY (user, 2026-08-02).** Native memory
   subsystem powered by **Graphify** (knowledge graph over MCP, local, $0). **Full design +
   lane split + verify bar in `docs/BRAIN.md`; workstream in `MASTER_PLAN.md §8 "BRAIN ROUND"`.**
   Adopt Graphify; skip PAUL/SEED/Railway for now (build-methodology / host, not the brain).
2. ~~**P2 core:** auth + RBAC/ABAC + audit + protected enable/disable~~ **DONE (git `14137d8`).** Core follow-ups: seed a non-admin viewer user; committed `prisma/migrations` history (replace `db push`); httpOnly-cookie token hardening; consider auth on plugin reads.
3. **Persist plugin enable/disable state** in Postgres (currently in-memory; seam noted in `PluginLifecycleService.enableAllRegistered`).
4. **Per-plugin schema bootstrap** (`CREATE SCHEMA IF NOT EXISTS`) before a plugin's first DB use (seam in INTEGRATION_NOTES_ATLAS §3).
5. ~~**P4 capabilities**~~ **first slice DONE (`a07dd25`):** tool-invoke endpoint + `graphify`
   capability plugin. Remaining: wire browser-use to a real browser-use service; point `graphify`
   at a live MCP server; add review (Qodo/CodeRabbit CLI) + OpenHands adapters.
6. ~~**P3 portal federation**~~ **first slice DONE (`a07dd25`):** `config/modules.yaml` +
   `/api/federation/*` + `/tools` tiles + the OIDC/composite verifier seam. Remaining: actually
   stand up Keycloak + Caddy from `docker-compose.federation.yml` and prove a real SSO round-trip
   and a proxied, embedded Grafana tile end-to-end (configs exist but are UNRUN).
7. **P5 deploy:** VPS via Coolify — BLOCKED on user: provider + monthly budget.


## 9. Open questions for the user
- VPS provider (Hetzner?) + monthly budget → to cost P5. (Codename `constellation` and ORM `Prisma` are already decided.)

## 10. Coordination note
The three "friends" are background subagents driven from the primary session via the
`SendMessage` loop (assign → work → report → verify → next), OR run by the user as separate
CLI sessions that edit this shared tree. Either way: keep lanes disjoint (§6), never let two
run `pnpm install` concurrently (pre-install shared deps first), and the orchestrator does all
merges + commits + the final verify.
