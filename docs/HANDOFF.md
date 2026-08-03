# Constellation — Live Handoff (for clau_partner)

> **Purpose.** This is the always-current handoff. If the primary session is
> interrupted or hits a limit, **clau_partner** reads THIS file (plus
> `docs/MASTER_PLAN.md`) and continues seamlessly with no other context.
>
> **clau_partner: you are a co-worker on this project. Follow the exact rules in
> §1 and keep BOTH this file and `docs/MASTER_PLAN.md` up to date at every
> milestone — same discipline the primary session follows.**
>
> **Last updated:** 2026-08-03 (Engine v0.2 round COMPLETE — tool-calling/approval/kill-restart/portal all PROVEN LIVE, 376 tests) · **Updated by:** clau_partner
> **Note for the agents:** the P3/P4 portal + API work IS committed — do not re-label it
> "uncommitted." Only the orchestrator commits, and only the orchestrator edits this header.
> **Project root:** `C:\Users\syed.mohamed\Claude\Code\constellation`

---

## 0. Roles & leadership (who's who)
- **The user** — product owner & final decision-maker. Owns direction, the locked decisions (C1–C10), all approvals, and anything with cost/risk (push, cloud, VPS/budget). Nothing irreversible happens without the user.
- **Polaris** — *lead orchestrator / technical lead* (the primary Claude Code session), and the DRIVER of this project. Owns the architecture, the work split, cross-boundary wiring, integration, verification, the git history, and this source-of-truth doc set. Named after the guiding star the others navigate by. **A new AI taking over the driver's seat: read `docs/ORCHESTRATOR.md` — it is Polaris's complete operating manual (mission, method, roadmap, required skills, and literal onboarding steps). You inherit the role and its disciplines; keep the name Polaris or pick your own star-name and update §0 here + the ORCHESTRATOR.md header.**
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

## 3. Current status (2026-08-03)
- **🤖 ENGINE v0.3 — REAL MODEL PROVIDERS round ✅ COMPLETE (clau_partner orchestrating SOLO, 2026-08-03). All 8 tasks done, gate-verified, LIVE-PROVEN, committed — see MASTER_PLAN §9 + HANDOFF §11 for the full round record.** OpenRouter as a SECOND ModelProvider (one key → GPT-OSS/Qwen/DeepSeek/Claude/…), real routing + fallback in `ModelRouterService`, cost-aware budget (costUSD now flows through `ModelUsage`), unconfigured-safe ($0/local default — no key, nothing crashes). OpenRouter is OPT-IN per task via the task's `model` field. **Tests: 376 → 412.**
  - **TASK 1 DONE (code `3d7d635`):** `OpenRouterModelProvider` — OpenAI-compatible chat completions, Bearer auth, usage + `costUSD` parsing (dollar-cap seam now real), transient/terminal error classification, `health()` never throws (honest "OPENROUTER_API_KEY is not set"), `canHandleModel()` (slash ids + `openrouter:` prefix; false when unkeyed). `ModelUsage.costUSD` + optional `ModelProvider.canHandleModel` added. Unconfigured-safe verified by design + typecheck; provider unit tests land in Task 2. Tests still **376**.
  - **TASK 2 DONE (code `341f30d`):** `openrouter-model-provider.test.ts` — **22 unit tests**, mocked fetch, no network: headers/body, usage + costUSD (usage.cost AND pricing derivation), model override, 5xx transient / 401-403-4xx terminal / network transient / timeout abort, no-key refusal, health (set/empty/unset/never-throws), constructor no-throw, canHandleModel matrix. **api tests 259 → 281** (suite 376 → **398**).
  - **TASK 3 DONE (code `9cd9ce4`):** `ModelRouterService` real routing + fallback — `selectProvider(model?)` routes by `canHandleModel` (no match → Ollama), non-default provider failure → **fallback to Ollama with DEFAULT_MODEL** (logged), `openrouter:`/`ollama:` prefixes stripped, health() aggregates all providers (`providers[]` summary, single-provider passthrough). `OllamaModelProvider.canHandleModel()` added. Typecheck + api suite green (**281**, no regressions).
  - **TASK 4 DONE (code `e97c290`):** 12 new router tests (all 14 existing kept verbatim): slash→OpenRouter, local→Ollama, no-model→Ollama, prefix stripping, no-match→Ollama, transient AND terminal OpenRouter failure→Ollama fallback (log asserted), Ollama failure propagates, aggregated health ×3. **api tests 281 → 293** (suite **398 → 410**).
  - **TASK 5 DONE (code `28c56b0`):** EngineModule registers OpenRouter (MODEL_PROVIDERS = [ollama, openrouter]); AgentWorker's hardcoded `markRunning(...,"ollama")` replaced — task marked running without a provider, then `markProvider(taskId, response.provider)` after the first model call (real provider recorded, incl. fallbacks). `TaskService.markProvider()` added. 2 new worker tests (provider-once, fallback-recorded). **api tests 293 → 295** (suite **410 → 412**).
  - **TASK 6 DONE (code `fe4b215`):** `.env.example` OpenRouter section (OPT-IN, placeholder key only, never a real key) + per-task `"model"` unlock docs. **Repo-wide four-gate pass at this point: 20/20 tasks green** (lint/build/typecheck/test; api **295**).
  - **TASK 8 DONE + LIVE-PROVEN (code `a32f6e7`, no key):** full stack live (postgres/redis:6380/brain:8791/7b, api:4001) with OpenRouter key ABSENT — boot clean, `engine:"available"`, health shows `openrouter reachable:false "OPENROUTER_API_KEY is not set"` honestly. Three tasks: no-model → `completed` on ollama (`provider:"ollama"` recorded honestly); `model:"openai/gpt-oss-120b"` → NO provider matches → **fallback to Ollama with DEFAULT_MODEL** (log: `no provider can handle "openai/gpt-oss-120b" — falling back to Ollama (ollama) with its default model`) → `completed` on ollama; `model:"qwen2.5-coder:7b"` → routed straight to Ollama → `completed`. Literal records in `artifacts/engine-v0.3/task8-*.json`. (Ran before Task 7 — user away; the router no-match refinement `aa18f7b` was required for the acceptance.)
  - **TASK 7 DONE + LIVE-PROVEN (code `1054e90`, key set):** task `cmsdegbhl000648fx5bfaz0up` with `model:"openai/gpt-oss-120b"` → router selected OpenRouter → CLOUD model drove `[0] tool_call graph.query` → `[1] tool_result ok:true` (48 real nodes) → `[2] done` (grounded summary) → **completed, `provider:"openrouter"` recorded honestly**. Usage+cost live-proven: direct probe returned `usage:{72,36,108 tokens, cost 8.28e-6}` (provider parses into input/output/total + costUSD, unit-tested). Honest gap: per-call usage not persisted on the task record (in-memory budget only) — follow-up noted. Total cloud spend ≈ $0.00001. Literal records in `artifacts/engine-v0.3/task7-*`.
  - **The headline proof:** an agent task called `graphify.graph.query` against the LIVE brain sidecar and completed on real data — `tool_call → tool_result (ok:true, 142 nodes) → done → completed`. Approval gate proven with a tool that REALLY RUNS (approve → execute-once → real data → complete; reject → failed, audited). Kill-restart proven ACROSS a tool call (frozen in Postgres, resumed, no double-execute). Portal `/engine` clicked in a real browser for the first time — submit/auto-refresh/drawer/Cancel/Approve/Reject all live (2 real bugs fixed: CORS :3005 identity-banner false positive + missing approve/reject portal UI). `AgentWorkerService` now unit-tested (12 tests). **Tests: 364 → 376.**
  - **TASK 1 DONE + LIVE-PROVEN (docs commit `d045022`):** an agent task CALLED the graphify `graph.query` tool against the LIVE brain sidecar (real graph: 1469 nodes / 2412 edges), got `tool_result` `ok:true` with real 142-node traversal data (real file:line provenance), and COMPLETED with a `done` summary grounded in that data. Step record `[0] tool_call → [1] tool_result → [2] done`, status `completed`. The headline gap is closed — full literal evidence in MASTER_PLAN §9.
  - **TASK 2 DONE + LIVE-PROVEN (docs commit `edd2ab9`):** approval gate proven with a tool that REALLY RUNS. Pause (nothing ran) → `POST /approve` → tool EXECUTED EXACTLY ONCE against the live sidecar (`ok:true`, 42 real nodes) → `done` grounded in it → `completed`; honour-once held (no re-pause on approved steps). Reject variant: pause → `POST /reject` → `failed` with `Rejected by admin@constellation.local`, all audited (`engine.task.approved` ×2 + `engine.task.rejected`). Full evidence in MASTER_PLAN §9.
  - **TASK 3 DONE + LIVE-PROVEN (docs commit `5d6f078`):** kill-restart ACROSS a real tool call. Killed the api the instant `[1] tool_result` was written → frozen in Postgres while down (`running, stepCount=2`, checkpoint at step 2 with messages) → restarted → resumed from the checkpoint and COMPLETED with exactly ONE tool_call + ONE tool_result (no double-execute), `done` grounded in the tool's data. Full evidence in MASTER_PLAN §9.
  - **TASK 4 DONE + LIVE-PROVEN (docs commit `9d27834`):** portal `/engine` clicked in a REAL browser for the first time (zero-dep CDP driver, real Chrome). Submit-via-form → auto-refresh → step drawer → Cancel → **Approve → Reject** all exercised against live tasks. Two real bugs fixed: (1) identity banner false-positive — :3005 wasn't CORS-allowed so the probe failed open (fixed in main.ts + .env.example, banner verified gone); (2) contract drift — the portal had NO approve/reject UI despite the v0.1 API routes (added clients + buttons in rows and the detail dialog). 15 screenshots in `artifacts/engine-portal/`. The "not clicked in a live browser" gap is CLOSED.
  - **TASK 5 DONE (docs commit `64ab70c`):** `AgentWorkerService` unit test — 12 tests pinning the loop's control flow (thought→continue, tool_call→dispatch+checkpoint, approval→pause+no dispatch, approved-once→dispatch+clear, done→complete, maxSteps→fail, transient→bounded retry then fail, terminal→fail immediately, +4 more). Mock strategy: `isEnabled:false` availability so no real Worker/Redis is created; loop driven through the `processJob` seam. **api tests 247 → 259.** Closes 1e-i + 1f-b.
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
  1. **The `pnpm` SHIM is broken on this host — but pnpm itself is fine.** The wrapper on
     `PATH` prepends `C:` to an already-MSYS-style path and dies with `MODULE_NOT_FOUND` on a
     mangled `C:\c\Users\...\corepack\dist\pnpm.js`. **The real `pnpm.js` exists and works.**
     Corrected 2026-08-02 by clau_partner (supersedes the old "pnpm is broken, never use it"
     wording, and explains Polaris's note in §2 that pnpm "worked fine from this shell"):
     - Preferred gate runner (still the safe default, no pnpm needed):
       `./node_modules/.bin/turbo run build|typecheck|test --force --concurrency=1`
     - When you genuinely need pnpm (`pnpm run <task>`, `--filter`, `install`), call it directly
       with a NATIVE Windows path and it works — verified pnpm **9.12.3**, `pnpm run typecheck`
       8/8 and `pnpm run test` 221 passing, identical to the turbo-direct run:
       `node "C:\Users\syed.mohamed\AppData\Local\hermes\node\node_modules\corepack\dist\pnpm.js" run <task>`
     Deps are already installed either way.
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

- **🧠 BRAIN ROUND DONE, LIVE-VERIFIED, COMMITTED (git `32c1ea8`, local only) — 2026-08-02, clau_partner:**
  the platform now has a persistent, queryable memory. SDK 0.2.0 (`memory.ts`, `PluginMemory`,
  `BRAIN_READ`/`BRAIN_WRITE`, `ctx.memory` least-privilege gating) · `apps/api/src/core/memory/**`
  (`BrainService` + `GraphifyAdapter` + guarded `POST /api/brain/query|remember`,
  `GET /api/brain/graph|stats`) · Atlas's Graphify sidecar (`brain` compose profile, MCP :8791,
  `infra/graphify/**`, `make brain*`) · Orion's portal Brain page (force-directed graph +
  ask-the-brain box w/ provenance) · the `brain/` vault.
  **Verified:** typecheck 8/8 · build 7/7 · tests **221**. Live against a **REAL repo-extracted
  graph (1238 nodes / 1937 edges)** in the containerized sidecar: `query` → `grounded:true` with
  real node provenance; `graph`/`stats` correct. Degraded (brain down / no graph) boots healthy and
  abstains honestly — no crash, no 500. **A real bug was found by that live pass and fixed:**
  `query()` had no `graph.json` fallback (CLI-only), so a built graph still said "brain not built
  yet" inside the container — `queryLocalGraph()` + 2 regression tests added. See MASTER_PLAN §9.
  **UNRUN gaps:** docs-mode (Ollama) indexing; the `remember()`→rebuild→node-appears round-trip;
  the Brain page clicked in a real browser.
- **⚠️ Two more host facts (2026-08-02):** `make` is **not installed** — run the `make brain*`
  targets as their underlying `docker compose --profile brain …` commands. Looper's
  `looper-gateway` squats host **:4000** — publish the api elsewhere with `API_HOST_PORT=4010`.
- **🧹 `lint` GATE REPAIRED — it had NEVER run (git `db0826f`, local only) — 2026-08-02, clau_partner:**
  `apps/web` declared `"lint": "next lint"` with **no ESLint config and no eslint dependency**, so it
  fell into an interactive setup prompt and died on non-TTY stdin. Verified pre-existing at base
  `2866129` — every prior round's "gates green" claim silently excluded lint. Added eslint 9 +
  `eslint-config-next` + a `FlatCompat` flat config, switched to `eslint .`, fixed the one real error
  (unescaped `'` in `settings/page.tsx`). **All four gates now: lint 2/2 · typecheck 8/8 · build 7/7 ·
  tests 256.** 17 warnings remain (pre-existing unused imports; Orion's portal lane, not a drive-by).
  **§7's standard pass now lists `lint` FIRST** — that omission is why this went unseen for so long.

- **🛰️🤖 P3 FEDERATION + P4 CAPABILITY WIRING LIVE-PROVED, COMMITTED (git `a4f28db`, local only) — 2026-08-02, clau_partner:**
  the federation overlay booted for the FIRST TIME (11 containers healthy: api, web, caddy, keycloak,
  prometheus, loki, grafana, postgres, redis, graphify, steel) and the agent plane now invokes REAL
  backends. Gates on the merged tree: **typecheck 8/8, build 7/7, tests 256** (api 141 · browser-use 47 ·
  graphify 40 · sdk 19 · cli 9). Full detail + literal evidence in MASTER_PLAN §9.
  **Reproducible SSO:** real Keycloak RS256 token → `/api/auth/me` **200**, tampered → **401**, local
  login unaffected, `OIDC_ISSUER_URL` unset → honest "SSO not configured" log.
  **Real invokes:** `browser.navigate`/`browser.extract` → live Steel Browser (`title:"Example Domain"`,
  real scraped content); `graph.query`/`graph.related` → live MCP sidecar (144 nodes, real file:line refs).
  **Seven bugs fixed that only live testing could expose** — 3 by Atlas (Loki `metric_aggregation_enabled`
  crash-loop, Keycloak `/auth/health/ready` 404, missing `OIDC_*` compose passthrough) and 4 by the
  orchestrator (see the NEW GOTCHAS in §3 below).
  **NOT done (explicit):** Orion's Brain-page fixes were root-caused in a real browser but never written —
  he stopped honestly at the diagnosis line; `open-webui`/`langflow` never booted; docs-mode (Ollama) unrun.

- **⚠️ NEW GOTCHAS (all found the hard way 2026-08-02 — read before verifying containers):**
  1. **Editing a healthcheck in compose does NOT change a running container.** Atlas's correct
     Keycloak fix sat in the YAML while the container kept failing the OLD probe 86 times and stayed
     `unhealthy`. You must `docker compose up -d --force-recreate <svc>`. Always confirm with
     `docker inspect <c> --format '{{json .Config.Healthcheck.Test}}'` that the probe you *think*
     you fixed is the one actually baked in.
  2. **`/api/health` reporting a plugin `enabled`+`ok` does NOT mean its tools work.** Health only
     probes the backend. `apps/api/Dockerfile` built only `hello-world`, so browser-use/graphify
     shipped with no `dist/` and every invoke failed `implements no invokeTool()` while health stayed
     green. **Any plugin you want to invoke must be added to BOTH the deps and builder stages.**
  3. **Manifest defaults silently shadow env-var fallbacks.** `PluginConfigFactory.hydrate()` seeds
     manifest defaults into plugin config, so a `"default": "cloud"` made `ctx.config.get("backend")`
     always truthy and rendered the `BROWSER_USE_BACKEND` fallback unreachable dead code. **If a
     setting is meant to fall back to env, its manifest default MUST be `""`.**
  4. **`GRAPHIFY_MCP_URL` is reserved for the CORE brain — never point the plugin at it.** Setting it
     disables the brain's graph.json fallback and breaks `/api/brain/query` when the sidecar is down.
     The capability plugin now uses `GRAPHIFY_PLUGIN_MCP_URL` (legacy name still read as a fallback).
  5. **A 200 + `isError:false` can still be a failure.** The Graphify sidecar answers unsupported tools
     with exactly that, body `"Unknown tool: ingest"` — which the plugin reported as `ok:true`. Mocked
     unit tests cannot catch this class of bug; only a live call can. Assert on the body, not just the
     status flag.
  6. **In-memory Keycloak (`start-dev`) loses hand-made realms on every recreate.** Runtime-clicked SSO
     config is not a reproducible proof. The realm is now declarative in
     `infra/keycloak/realm-constellation.json` and auto-imported via `--import-realm`.
  7. **Killing a background session does NOT kill the `exec node` child.** (Found hard 2026-08-03.) A
     `process kill` on the session ends the bash wrapper; the `node dist/main.js` it `exec`'d keeps
     serving and its BullMQ worker keeps picking up jobs — a stale API silently serving OLD env/code
     (e.g. `ENGINE_REQUIRE_APPROVAL_ALL` unset) while the "new" boot crashes with `EADDRINUSE`. ALWAYS
     kill by port owner and verify the port is free:
     `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"`.
     A stale worker also steals Ollama CPU and makes model calls abort (`This operation was aborted`).
  8. **`MODEL_TIMEOUT_MS` default 60s is too tight for qwen2.5-coder:7b on CPU when a large tool result
     is in context** (found live 2026-08-03 — generation can exceed 180s on a ~2000-token tool result).
     The v0.1 bounded retry absorbs it (task still completes), but for live round work boot with
     `MODEL_TIMEOUT_MS=180000` (the v0.2 boot script `scripts/boot-api-v0.2.sh` does this by default).
  9. **A portal dev port missing from `CORS_ORIGINS` makes the IdentityBanner fail OPEN** (found live
     2026-08-03): the probe fetch is CORS-blocked and the banner falsely reports "Connected to the
     wrong API" even when the API is correct. The api default + `.env.example` now include `:3005`
     (the documented `WEB_HOST_PORT` remap); add any new dev port to both.

- **🤖 ENGINE v0 DONE, typecheck + build + tests all green, COMMITTED (git `28f1125`, local only) — 2026-08-02, Polaris:**
  The agentic engine layer is now real. This was the single biggest missing piece (verified by code search: 0 LLM clients, 0 queues, 0 workflow engines in the platform before this commit).
  - **`bullmq`** installed; **Redis** (already in Compose, unused until now) is now the durable job backend.
  - **`ModelRouterService`** — provider-agnostic Ollama client (`fetch`-based, `$0` local). Calls `POST /api/chat`, timeout-guarded, health-checkable. Designed for future providers (Claude, GPT) to slot in without touching callers.
  - **`AgentWorkerService`** — BullMQ `Worker` (concurrency=2). ReAct-style loop: model → parse JSON action → `thought|tool_call|done|error` → dispatch via `PluginToolService` (trusted internal caller, `["platform:admin"]` permissions) → checkpoint every step → resume from checkpoint on restart. Cancellation polled each iteration.
  - **`TaskService`** — CRUD on `AgentTask` / `TaskStep` / `TaskCheckpoint`. Uses `this.prisma.db` pattern (graceful no-DB degradation, same as every other core service).
  - **`TaskQueueService`** — BullMQ `Queue` producer. `enqueue(taskId)` → job with retry backoff. `getHealth()` exposes waiting/active/failed counts.
  - **`EngineController`** — 5 routes: `POST /engine/tasks` (submit), `GET /engine/tasks` (list), `GET /engine/tasks/:id` (detail+steps), `POST /engine/tasks/:id/cancel`, `GET /engine/health` (@Public).
  - **Prisma schema**: 3 new models (`AgentTask`, `TaskStep`, `TaskCheckpoint`) pushed to DB.
  - **`.env.example`**: `OLLAMA_BASE_URL`, `DEFAULT_MODEL`, `MODEL_TIMEOUT_MS`, `ENGINE_MAX_STEPS` documented.
  - **Gates:** typecheck `0 errors` · API tests `141 pass` (0 regressions) · build `7/7`.
  - **To use locally:** `ollama pull <model>` (this host has `qwen2.5-coder:1.5b`/`7b`, not `llama3.2` — set `DEFAULT_MODEL` or pass `model` per-task) → start stack (`docker compose up -d`) → `POST /api/engine/tasks {"title":"test","prompt":"Say hello"}` → `GET /api/engine/tasks/:id`.

- **🤖 ENGINE v0 FOLLOW-UP ROUND DONE, KILL-RESTART ACCEPTANCE PROVEN LIVE — 2026-08-02, Polaris (integrating Nova/Orion/Atlas):**
  Nova, Orion, and Atlas worked disjoint lanes concurrently (§8 1a/1b/1d from the prior round) and each verified clean in isolation. Polaris integrated all three and found 5 bugs none of them could see individually (each only ran their own package):
  1. **`ioredis` missing from node_modules** — bullmq 6.x made it an optional peer dep, `pnpm install` never pulled it in. Fixed: added as an explicit direct dependency.
  2. **bullmq 6.x's `ConnectionOptions` type is now a union** (single-node ∪ Cluster ∪ Sentinel) — broke `tsc` on both `task-queue.service.ts` and `agent-worker.service.ts`. Fixed: narrow local `RedisConnectionOptions` interface, cast at the bullmq call site only.
  3. **`import type { CreateTaskDto }` silently broke `POST /engine/tasks`** — TS erases `import type`, so `emitDecoratorMetadata` had nothing for `design:paramtypes`, so Nest's `ValidationPipe` rejected every field as unknown. **Gates were green the whole time; the endpoint was dead.** Fixed: value import. ⚠️ **Watch for this pattern elsewhere — any DTO imported as `import type` for a `@Body()` param is silently broken the same way.**
  4. **`REDIS_HOST_PORT=6380` in this host's `.env`**, not the Compose default 6379 — cost time diagnosing a hang (ioredis retries `ECONNREFUSED` forever by default).
  5. **`parseAction`'s greedy regex broke on a real small model** (`qwen2.5-coder:1.5b` emitted multiple JSON objects in one code-fenced reply instead of one-per-turn; the regex spanned all of them into invalid JSON, so every step silently degraded to "thought" and the task always hit `maxSteps` and failed). Fixed: `extractFirstJsonObject()` brace-counting helper + tightened system prompt ("EXACTLY ONE JSON object... do not wrap in a code fence").
  - **Gates (all 20 tasks, merged tree):** lint 20/20 · build 20/20 · typecheck 20/20 · test 20/20 (187 api tests: 141 + Nova's 46 new).
  - **Kill-restart acceptance test — RUN LIVE against real Ollama/Postgres/Redis, not simulated:** submitted a 20-step task, watched `stepCount` climb to 6, **killed the API process**, **queried Postgres directly while the API was down** to confirm `status=running, stepCount=6` (proves durability, not in-memory state), restarted the API, watched the stalled BullMQ job resume and `stepCount` continue climbing from 6 (not reset to 0). After the parser fix, a fresh task completed end-to-end in 1 step with a real `done` result. **This is the Engine v0 acceptance criterion, proven.**
  - **Portal:** Orion built `/engine` — submit form, auto-refreshing task table, step-detail drawer, cancel button, engine health strip. Verified by typecheck+lint only (not clicked in a live browser — same caveat as the Brain page).
  - **Ollama compose + identity fix:** Atlas added an `ollama` service (profile `engine`) to `docker-compose.yml` and `GET /api/identity` (fixes D-2: a foreign process on port 4000 no longer looks like this API).
  - **Honest gap:** the acceptance test proves checkpoint/resume + the parser fix; it does NOT exercise a `tool_call` being killed and resumed mid-dispatch (the passing re-run had no tool call). `AgentWorkerService` itself still has no unit test (Nova skipped it — too many deps for a first pass).

- **🤖 ENGINE v0.1 — HARDEN & GATE round: ALL 5 TASKS DONE + committed (2026-08-02, clau_partner orchestrating SOLO).** Redis-degrade (`e1fd016`) · approval gate (`3a24898`) · ModelProvider + token budget (`7217568`) · portal API base :4001 + identity banner (`0c41813`) · transient model-error retry + redis dedup (`d5901ba`). All gate-verified + live-proven. Full detail in MASTER_PLAN §9. (Round summary + final smoke in §11.)
- **Known follow-ups (not blockers):** plugin READ endpoints are `@Public` for P2 (module list isn't sensitive; harden to authed + httpOnly-cookie tokens later); portal token is in-memory+localStorage (XSS caveat noted in code); no committed `prisma/migrations` history yet (Docker entrypoint uses `db push`); a viewer (non-admin) user isn't seeded so the 403 UI path is unit-tested, not live-clicked.
- **Remaining Docker check:** ~~a full 4-service `docker compose up --wait`~~ **DONE 2026-08-02** —
  postgres + redis + api (+ the graphify sidecar) all booted healthy together during the brain
  verification; the api image was rebuilt from source and served live traffic.

## 4. Repo layout (monorepo)
```
constellation/
├── apps/api/            # NestJS core: bootstrap, config, plugin loader/registry/lifecycle/health, DB (Prisma), logging(pino), settings, events
│   ├── prisma/          # schema.prisma (core schema); prisma.config.ts
│   └── src/core/{plugins,database,logging,settings,events,health,auth,rbac,audit,federation,engine}
│       ├── auth/        # JWT login + guards; TOKEN_VERIFIER seam → local-jwt / oidc-jwt / composite
│       ├── plugins/     # + plugin-tool.service.ts (agent-plane dispatch) + dto/invoke-tool.dto.ts
│       ├── federation/  # reads config/modules.yaml → GET /api/federation/modules|:id|status
│       └── engine/     # Engine v0: TaskService + TaskQueueService + AgentWorkerService + ModelRouterService + EngineController
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
> **The `pnpm` SHIM is broken on this host, not pnpm — see §3 gotcha 1** (corrected 2026-08-02).
> Use turbo directly below: always `--force` (cache reports false greens) and `--concurrency=1`
> (parallel runs fail spuriously). If you specifically need `pnpm run`/`--filter`/`install`, the
> direct-invocation form in §3 gotcha 1 works (pnpm 9.12.3, verified against the same gates).
```bash
cd C:/Users/syed.mohamed/Claude/Code/constellation
cd apps/api && ./node_modules/.bin/prisma generate && cd ../..   # needed before the api build
./node_modules/.bin/turbo run lint      --force --concurrency=1   # expect 2/2  <- DON'T SKIP
./node_modules/.bin/turbo run build     --force --concurrency=1   # expect 7/7
./node_modules/.bin/turbo run typecheck --force --concurrency=1   # expect 8/8
./node_modules/.bin/turbo run test      --force --concurrency=1   # expect 256 tests
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
1h. **🤖 ENGINE v0.3 — REAL MODEL PROVIDERS round (clau_partner, orchestrating SOLO — Nova/Orion/Atlas resting).** OpenRouter as a second ModelProvider (user has API keys), real routing + fallback, cost-aware budget. Ollama stays the $0 default; OpenRouter is opt-in per task. NO push, secrets only in `.env`.
   - [x] **Task 1 — `OpenRouterModelProvider`** (DONE, code `3d7d635`): OpenAI-compatible chat completions + Bearer auth, usage + `costUSD` parsing, transient/terminal error classes, never-throwing `health()`, `canHandleModel()`. `ModelUsage.costUSD` + optional `ModelProvider.canHandleModel` added. Unconfigured-safe.
   - [x] **Task 2 — provider unit tests** (DONE, code `341f30d`): 22 tests, mocked fetch.
   - [x] **Task 3 — `ModelRouterService` real routing + fallback** (DONE, code `9cd9ce4` + follow-up `aa18f7b`): `canHandleModel` selection; OpenRouter failure → Ollama fallback with DEFAULT_MODEL; prefix stripping; aggregated health. Follow-up: no-match models also fall back to Ollama with DEFAULT_MODEL (a raw cloud id would 404 terminally).
   - [x] **Task 4 — router unit tests** (DONE, code `e97c290`): 12 new, all 14 existing kept.
   - [x] **Task 5 — wire into EngineModule + AgentWorker** (DONE, code `28c56b0`): provider registered; REAL provider recorded on the task after the first model call (no hardcoded "ollama").
   - [x] **Task 6 — `.env.example` OpenRouter section** (DONE, code `fe4b215`): placeholder only, never a real key.
   - [x] **Task 7 — LIVE-PROVE cloud E2E** (DONE + LIVE-PROVEN, code `1054e90`): `model:"openai/gpt-oss-120b"` task completed via OpenRouter — `tool_call graph.query → tool_result ok:true (48 real nodes) → done`, `provider:"openrouter"` recorded honestly; usage+cost live-proven ($0.00001 total). Honest gap: per-call usage not persisted on the task record (in-memory budget only).
   - [x] **Task 8 — LIVE-PROVE fallback with no key** (DONE + LIVE-PROVEN, code `a32f6e7`): health honest, "/" model falls back to Ollama DEFAULT_MODEL and completes, provider recorded honestly.
   - **ROUND COMPLETE — all 8 tasks done; round summary commit follows (like `f92a3a7` in v0.2).**
1g. **🤖 ENGINE v0.2 — "Prove It For Real" round (clau_partner, orchestrating SOLO — Nova/Orion/Atlas resting).** The engine has proven machinery; this round proves the agent actually does REAL WORK with it. NO new features (scheduler is next round).
   - [x] **Task 1 — tool-calling end-to-end PROVEN LIVE** (DONE, docs commit `d045022`): agent task called graphify `graph.query` against the live brain sidecar → real `tool_result` (ok:true, 142 nodes, real provenance) → `done` grounded in it → `completed`. Full evidence in MASTER_PLAN §9. Closes the headline gap.
   - [x] **Task 2 — approval gate proven with a tool that REALLY RUNS** (DONE, docs commit `edd2ab9`): approve → executed exactly once → real data → completed; reject → failed with audited reason. Full evidence in MASTER_PLAN §9.
   - [x] **Task 3 — kill-restart survival ACROSS a tool call** (DONE, docs commit `5d6f078`): killed right after tool_result, frozen `running/stepCount=2` in Postgres, resumed → completed with exactly one tool_call+tool_result (no double-execute). Covers 1e-ii. Full evidence in MASTER_PLAN §9. Boundary recorded: mid-invoke window is at-least-once by design (read tools harmless; approval gate guards writes).
   - [x] **Task 4 — portal `/engine` page clicked in a live browser** (DONE, docs commit `9d27834`): real Chrome via new zero-dep `scripts/cdp-browser.mjs`; submit/auto-refresh/step-drawer/Cancel/Approve/Reject all exercised live; fixed the false identity banner (CORS :3005) + added the missing approve/reject portal UI. Covers 1b + 1f-c. 15 screenshots in `artifacts/engine-portal/`.
   - [x] **Task 5 — `AgentWorkerService` unit test** (DONE, docs commit `64ab70c`): 12 tests pinning the full loop control flow (thought/tool_call/approval/approved-once/done/maxSteps/transient-retry/terminal-error). **api tests 247 → 259.** Covers 1e-i + 1f-b.
   - [x] **Task 6 — checkpoint write volume** (DONE as RECORD + SKIP, per the brief's "if it's not clean, leave the note and move on"): the O(n²) note stays in §8-1f-a below. Evaluation this round: Prisma Json upserts rewrite the whole column regardless of what the worker sends (a true delta needs raw-SQL `jsonb ||` append on the proven resume contract); history-capping risks dropping the system prompt/task goal on resume; `maxSteps=20` bounds real volume (no measurable latency on ~40-message checkpoints). Future fix if ever needed: raw-SQL append in `TaskService.saveCheckpoint`.
1. ~~**🤖 Engine v0 — Durable Task Runtime + Ollama model router.**~~ **DONE (git `28f1125`).**
1a. ~~**Engine tests**~~ **DONE (Nova, 46 new tests, 187 total).**
1b. ~~**Portal `/engine` page**~~ **DONE (Orion — submit form, task table, step drawer, cancel, health strip). Not yet clicked in a live browser.**
1c. ~~**Kill-restart acceptance test**~~ **DONE, PROVEN LIVE (Polaris — see HANDOFF §3 and MASTER_PLAN §9 for full evidence).**
1d. ~~**Lint pass**~~ **DONE — 20/20 gate tasks green, 0 new warnings from engine files.**
1e. **Engine follow-ups (new, from this round's integration):** (i) unit test for `AgentWorkerService` itself — skipped so far, needs a mocking strategy for the BullMQ Worker + model router + plugin tool service combo; (ii) a tool-calling variant of the kill-restart acceptance test (kill mid-`tool_call`, not mid-`thought`); (iii) audit the rest of the codebase for the `import type` + `@Body()` DTO bug pattern found in `engine.controller.ts` (§9) — any other controller importing its DTO as `import type` has a silently-broken validation pipe; (iv) `ollama pull llama3.2` or update `.env.example`'s `DEFAULT_MODEL` to match what's actually installed on a fresh host (this host has `qwen2.5-coder:1.5b`/`7b`, not `llama3.2`).
1f. **🤖 ENGINE v0.1 — Harden & Gate round (clau_partner, orchestrating SOLO — Nova/Orion/Atlas resting; fixes Polaris's 6 review issues; NO new scope).**
   - [x] **Task 1 — engine degrades cleanly with no Redis** (DONE, git `e1fd016`): fail-fast Redis options + `EngineAvailabilityService` probe + availability-gated Queue/Worker + 503 on submit + honest `/engine/health`. Live-proven both ways (Redis down → clean 503/health; up → full task run). See MASTER_PLAN §9.
   - [x] **Task 2 — human-in-the-loop approval gate** (DONE, git `3a24898`): SDK manifest v2 `requiresApproval` (additive, SDK 0.3.0) + `ENGINE_REQUIRE_APPROVAL_ALL` supervised switch + paused/pending_approval state machine + approve/reject routes (Bearer, audited, honour-once) + `ENGINE_AGENT_PERMISSIONS` named role seam. Gate-verified (345 tests) + LIVE-PROVEN (pause→approve→exactly-once→continue; reject→failed `Rejected by <email>`; audit rows; Redis-down boot clean). See MASTER_PLAN §9.
   - [x] **Task 3 — ModelProvider interface + per-task token-budget cap seam** (DONE, git `7217568`): `ModelProvider` interface + `OllamaModelProvider` first implementation + `ModelRouterService` as selector over `ModelProvider[]` + `TokenBudget` per-task ceiling (`task.maxTokens ?? ENGINE_MAX_TOKENS_PER_TASK`, dollar-cap seam documented). 239 api tests; live 1-step hello→done through the new interface, `maxTokens` persisted. See MASTER_PLAN §9.
   - [x] **Task 4 — portal API base :4001 + startup identity banner** (DONE, git `0c41813`): shared `lib/api-base.ts` (default `http://localhost:4001/api`) + all 7 portal clients import it + `IdentityBanner` probing `/api/identity` (wrong API → clear amber banner, incl. on login). LIVE-proven in a real browser both ways (squatted :4000 → banner fires; real :4001 → clean). See MASTER_PLAN §9.
   - [x] **Task 5 — retry transient model errors + shared redis-connection util** (DONE, git `d5901ba`): `ModelCallError` transient/terminal classification (5xx/network/timeout retryable; 4xx terminal) + `retryTransient()` bounded retry (`ENGINE_MODEL_RETRIES`=3, 500ms*attempt backoff) in the worker; 5b dedup verified already done in Task 1 (both services import the shared `redis-connection.ts`). 247 api tests (+8); LIVE fake-Ollama proof: first-call 503 → task completed; unknown-model 404 → failed terminally. See MASTER_PLAN §9.
   - **Recorded (don't fix) gaps from this round, carried in §8 so they're not lost:** (a) checkpoint rewrites the full growing `messages` array every step — O(n²) write volume, fine at 20 steps; (b) `AgentWorkerService` still has no unit test — Task 2's live pass exercises the pause/approve path but is not a unit test; (c) the portal `/engine` page has not been clicked in a live browser. — **ALL THREE RESOLVED in Engine v0.2 (2026-08-03):** (a) evaluated + deliberately skipped (see §8 Task 6); (b) 12 unit tests landed (`64ab70c`); (c) clicked live, 2 bugs fixed (`9d27834`).
2. ~~**🧠 THE BRAIN (Memory & Knowledge Graph) — TOP PRIORITY (user, 2026-08-02).**~~
   **DONE, live-verified, COMMITTED (git `32c1ea8`)** — see §3 and MASTER_PLAN §9. Graphify adopted
   (knowledge graph over MCP, local, $0); design in `docs/BRAIN.md`. **Remaining brain follow-ups
   (small, not blockers):** docs-mode indexing via local Ollama (`GRAPHIFY_MODE=docs`); the
   `remember()` → `brain-rebuild` → note-appears-as-a-node round-trip; clicking the portal Brain
   page in a real browser against the live graph.
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

## 11. In-flight state & deferred options (updated by clau_partner, 2026-08-03)
**🤖 ENGINE v0.3 — REAL MODEL PROVIDERS: ✅ ALL 8 TASKS DONE, gate-verified, LIVE-PROVEN, committed.** clau_partner orchestrated solo (Nova/Orion/Atlas resting). Commits, oldest first: `3d7d635` Task-1 OpenRouterModelProvider · `341f30d` Task-2 provider tests (22) · `9cd9ce4` (+`aa18f7b` no-match DEFAULT_MODEL follow-up) Task-3 real routing + fallback · `e97c290` Task-4 router tests (12) · `28c56b0` Task-5 wiring + honest provider recording · `fe4b215` Task-6 .env.example · `c63f6bd` Task-7 driver · `a32f6e7` Task-8 no-key live proof · `1054e90` Task-7 cloud live proof · round summary at the final commit. **Gates: lint/build/typecheck/test all green · tests 412 (api 295 · sdk 21 · browser-use 47 · graphify 40 · cli 9) — was 376 (+36).** LIVE-PROVEN both ways: cloud task completed on real tool data via OpenRouter (`provider:"openrouter"`, ~$0.00001 total spend), and with no key every task completes on Ollama (honest health, honest provider field, nothing crashes). Recorded follow-up: per-call usage/cost is not persisted on the task record (in-memory TokenBudget only). Full literal evidence in MASTER_PLAN §9.
**🤖 ENGINE v0.2 — "PROVE IT FOR REAL": ✅ ALL 5 TASKS DONE, gate-verified, LIVE-PROVEN, committed; Task 6 recorded+skipped per the brief.**
clau_partner orchestrated solo (Nova/Orion/Atlas resting). Commits, oldest first:
`d045022` (+`de87cd0`) Task-1 tool-calling PROVEN LIVE · `edd2ab9` (+`761d295`) Task-2 approval-with-real-tool ·
`5d6f078` (+`716bbaa`) Task-3 kill-restart across a tool call · `9d27834` (+`d54b0c0`) Task-4 portal live-browser
(two real bugs fixed: CORS identity-banner false positive + missing approve/reject UI) · `64ab70c` (+`7692a12`)
Task-5 AgentWorkerService unit tests · round summary at `f92a3a7`.
**Gates (`--force --concurrency=1`): lint/build/typecheck/test all green · tests 376 (api 259 · sdk 21 ·
browser-use 47 · graphify 40 · cli 9) — was 364 (+12).** Live-proven end-to-end: agent tasks completed on REAL
tool data (graph.query/graph.related → live 1469-node brain graph), approval gate executes approved calls
exactly once with real results, kill-restart survived a real tool call with no double-execute, and the
portal /engine page was driven in a real Chrome (submit → auto-refresh → drawer → Cancel/Approve/Reject).
Full literal evidence in MASTER_PLAN §9.
**Carried forward as UNRUN / NOT DONE (recorded, not hidden):**
1. **Orion's Brain-page fixes — diagnosed but NOT written.** He root-caused the real problems in a
   live browser against the 1241-node graph (force-layout perf at that scale, label overlap,
   degraded/`available:false` UI) and honestly stopped at the diagnosis line when his budget ran out.
   The analysis is in his transcript; the code does not exist. **This is the obvious next lane.**
2. docs-mode (Ollama) brain indexing, and the `remember()`→rebuild→node-appears round-trip.
3. `open-webui` / `langflow` federation tiles — never booted (GB-scale images, outside the SSO/proxy
   proof scope).
4. 17 pre-existing lint warnings in `apps/web` (unused imports/vars, one stale `eslint-disable`) —
   Orion's portal lane, deliberately not a drive-by fix in an infra commit.
5. **Engine v0.2 recorded, non-blocking:** (a) checkpoint O(n²) message rewrites — evaluated and
   deliberately SKIPPED this round (see §8 Task 6; raw-SQL `jsonb ||` append is the future fix if ever
   needed); (b) mid-invoke crash window is at-least-once by design (read tools harmless; the approval
   gate + `requiresApproval` guards writes — a dedicated exactly-once pass only matters once write-tool
   idempotency does). Leftover dev task rows cleared by the round-end `docker compose down --volumes`.

**Deferred option — "Vega" (QA/reviewer agent), NOT active.** A read-only 5th helper that offloads the
integrator's verification burden: it runs the full gate + a security review on a GIVEN COMMITTED SHA,
in an ISOLATED checkout (its own worktree/clone, own port e.g. :4055, own docker project), triggered
BY the orchestrator at an integration boundary — never free-running on the live tree, never commits,
never edits docs. Decision (user, 2026-08-02): **not needed now; revisit only if the integration/verify
queue becomes the bottleneck.** Do NOT introduce a new actor mid-round.
