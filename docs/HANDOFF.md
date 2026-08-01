# Constellation — Live Handoff (for clau_partner)

> **Purpose.** This is the always-current handoff. If the primary session is
> interrupted or hits a limit, **clau_partner** reads THIS file (plus
> `docs/MASTER_PLAN.md`) and continues seamlessly with no other context.
>
> **clau_partner: you are a co-worker on this project. Follow the exact rules in
> §1 and keep BOTH this file and `docs/MASTER_PLAN.md` up to date at every
> milestone — same discipline the primary session follows.**
>
> **Last updated:** 2026-08-01 · **Updated by:** primary session (orchestrator)
> **Project root:** `C:\Users\syed.mohamed\Claude\Code\constellation`

---

## 1. Working rules (MANDATORY — clau_partner follows these too)
1. **Checklist first.** Before starting work, write a complete checklist of everything you will do. Do not assume; do not skip.
2. **Finish one task before starting the next.** No half-done parallel threads.
3. **Verify before "done."** Maker/checker: nothing is complete until it builds + typechecks + tests + (where relevant) boots. Re-run, don't trust a claim.
4. **$0 / local only.** Never provision cloud or install paid services. No cloud until the user explicitly approves + confirms cost (the VPS is chosen but NOT provisioned).
5. **Never `git push` and never commit to a remote without an explicit in-the-moment go-ahead.** Local commits are fine and expected.
6. **Never commit secrets.** `.env` is git-ignored; keep it that way.
7. **Keep docs current.** Update THIS file and `docs/MASTER_PLAN.md` at every milestone (status, done, pending, next, decisions).
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

## 3. Current status (2026-08-01)
- **P0 foundation:** DONE + committed (git `0311028`), verified end-to-end.
- **Dependency prep:** committed (git `0ada50f`).
- **Round 1** (Atlas data-layer+context services; Nova loader-hardening+CLI; Orion portal-shell+docs): **DONE**, integrated by the orchestrator (context factory wired, health summary folded in). Build/typecheck/tests were green post-integration.
- **Round 2** (Atlas Docker/Compose/CI; Nova SDK `tools`+browser-use plugin+lifecycle events; Orion plugin-detail/admin/live-health): **LANDED in the working tree, UNCOMMITTED.** Orchestrator is running the consolidated re-verification now (this session).
- **Everything since `0ada50f` is uncommitted.** Nothing pushed. No cloud provisioned.

## 4. Repo layout (monorepo)
```
constellation/
├── apps/api/            # NestJS core: bootstrap, config, plugin loader/registry/lifecycle/health, DB (Prisma), logging(pino), settings, events
│   ├── prisma/          # schema.prisma (core schema); prisma.config.ts
│   └── src/core/{plugins,database,logging,settings,events,health}
├── apps/web/            # Next.js App Router portal: shell, sidebar (manifest-driven), theme, ⌘K palette, modules/detail/admin/settings
├── packages/plugin-sdk/ # THE contract: manifest (Zod) + Plugin lifecycle + PluginContext + permissions (+ tools, agent-plane)
├── packages/cli/        # @constellation/cli — generate-plugin scaffolder
├── plugins/hello-world/ # reference plugin
├── plugins/browser-use/ # first agent-plane capability plugin (tools: browser.navigate/act/extract)
├── docker-compose.yml, Makefile, apps/*/Dockerfile, .github/  # Atlas R2 infra
└── docs/{MASTER_PLAN.md, HANDOFF.md (this), PLUGIN_SDK.md, ORION_ROUND2.md}
```

## 5. TWO VERIFIED BUGS — never regress (see MASTER_PLAN §9)
1. **Windows dynamic import** needs `pathToFileURL()` → `file:///C:/…`, not string `file://C:/…`.
2. **CJS downleveling:** under `module: CommonJS`, tsc rewrites `import()` → `require()`, which can't load an ESM plugin. The loader uses `const esmImport = new Function("s","return import(s)")` to preserve a real dynamic import. Tests swap it via `__setEntryImporterForTests` (a Vitest vm limitation, not a defect).

## 6. Friend file-ownership lanes (keep disjoint)
- **Atlas (infra/data):** `apps/api/src/core/{database,logging,settings,events}`, `apps/api/prisma`, `apps/api/src/app.module.ts`, Docker/Compose/Makefile/CI, README "Run with Docker".
- **Nova (SDK/core-plugins/capabilities):** `packages/**`, `apps/api/src/core/plugins/**`, `plugins/<new capability>/**`.
- **Orion (portal/DX):** `apps/web/**`, `docs/*` (NEVER `docs/MASTER_PLAN.md`).
- **Orchestrator only:** `docs/MASTER_PLAN.md`, cross-boundary wiring (e.g. `plugin-context.factory.ts` pulling Atlas services), `docs/HANDOFF.md`, all installs, all git commits.

## 7. How to verify (the standard pass)
```bash
cd C:/Users/syed.mohamed/Claude/Code/constellation
corepack enable && pnpm install
pnpm --filter @constellation/api exec prisma generate   # needed before api build
pnpm build && pnpm typecheck && pnpm test
# live boot (port 4000 is often occupied locally by a stray gateway — use 4001):
cd apps/api && API_PORT=4001 node dist/main.js   # GET /api/health, /api/plugins
# full stack: docker compose up -d --build   (or: make up)
```

## 8. Pending / next actions (priority order)
1. **(this session)** Finish consolidated re-verification of round-2, then commit the verified snapshot; update MASTER_PLAN §8/§9.
2. **P2 core:** Auth (JWT/OIDC) + RBAC/ABAC engine + admin mutations (enable/disable endpoints the portal already links to) + audit log.
3. **Persist plugin enable/disable state** in Postgres (currently in-memory; seam noted in `PluginLifecycleService.enableAllRegistered`).
4. **Per-plugin schema bootstrap** (`CREATE SCHEMA IF NOT EXISTS`) before a plugin's first DB use (seam in INTEGRATION_NOTES_ATLAS §3).
5. **P4 capabilities:** wire browser-use to a real browser-use service; add Graphify(MCP), review (Qodo/CodeRabbit CLI), OpenHands adapters.
6. **P3 portal federation:** SSO (Keycloak/Authentik) + reverse proxy + `modules.yaml`; embed Grafana/Langflow/Open WebUI/Coolify tiles.
7. **P5 deploy:** VPS via Coolify — BLOCKED on user: provider + monthly budget.

## 9. Open questions for the user
- VPS provider (Hetzner?) + monthly budget → to cost P5. (Codename `constellation` and ORM `Prisma` are already decided.)

## 10. Coordination note
The three "friends" are background subagents driven from the primary session via the
`SendMessage` loop (assign → work → report → verify → next), OR run by the user as separate
CLI sessions that edit this shared tree. Either way: keep lanes disjoint (§6), never let two
run `pnpm install` concurrently (pre-install shared deps first), and the orchestrator does all
merges + commits + the final verify.
