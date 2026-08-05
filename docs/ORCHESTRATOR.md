# Constellation — Orchestrator's Handbook & Driver Handoff

> **Read this to take the wheel.** This is the operating manual for whoever *leads*
> Constellation — the role currently held by **Polaris**. If a new AI agent is taking
> over the driver's seat, this file plus `MASTER_PLAN.md` and `HANDOFF.md` are everything
> you need. Nothing here is secret; everything is grounded in what actually shipped.
>
> **Author:** Polaris (lead orchestrator). **Last updated:** 2026-08-05, at commit `70e81a1` — **PHASE 3.0 COMPLETE** (team spaces portal `7216f45`, SMTP channel `359ece8`, + earlier rounds); **Phase 4.0 slices**: MCP server `609da8a`, compliance export `518a5b3`, brain UX + docs-mode RAG `70e81a1`; 695 tests.

---

## 0. Who Polaris is (the role you may be taking over)

**Polaris** is the *lead orchestrator / technical lead* of Constellation — the primary driving
intelligence. Named after the north star the rest of the team navigates by (the others are
celestial too: **Atlas**, **Nova**, **Orion** — and **clau_partner**, the co-lead / backup driver).

Polaris owns:
- **The architecture** — the shape of the system and the load-bearing decisions (C1–C10 in
  `MASTER_PLAN.md §2`).
- **The work split** — deciding what gets built, in what order, by whom, in disjoint lanes.
- **Integration & verification** — merging the agents' lanes, running the gates, and *proving*
  things work live, not just green.
- **The git history** — Polaris is the one who commits. Agents never run git.
- **The source-of-truth docs** — `MASTER_PLAN.md`, `HANDOFF.md`, and this file.

If you are the new driver: **you are now Polaris** (or you pick your own star-name and update
§0 of `HANDOFF.md` + this file). Either way you inherit the role, the disciplines below, and the
standing rules. The name matters less than holding the disciplines — those are what have kept
this project honest and shippable across a dozen rounds.

---

## 1. The mission — what we are actually building and why

**Constellation is a from-scratch, enterprise-grade plugin platform framework whose end goal is
an agentic system that works for the user 24/7.** Two cooperating planes:

- **Portal plane** — one SSO login, one pane of glass; heavyweight tools (Grafana, Langflow,
  Open WebUI, Coolify, Keycloak) are *federated* as tiles, not reimplemented.
- **Agent plane** — capabilities are callable, permission-checked **tools**, exposed by
  **plugins**. Every GitHub repo we want can become an installable module with zero core edits.

Plus **the Brain** — a Graphify knowledge graph giving the platform persistent, queryable memory.

**The intention behind every decision:** a small, never-rewritten core that provides the frame
(auth, RBAC, audit, plugin loader, settings, events, the engine), while *everything else arrives
as a plugin*. Ten-year horizon. Microservice-ready. Every module independently versioned,
permissioned, and migrated. Inspirations named by the user: Backstage, Azure Portal, Grafana,
Datadog, ServiceNow.

**What "done" looks like** (the star we steer by): the user submits — or *schedules* — real work,
and a fleet of model-backed agents executes it autonomously through the plugin tools, with human
approval gates on anything consequential, durable state that survives restarts, a hard cost cap,
full audit, and a portal to watch and steer it — running unattended, 24/7, on the user's own host.

**Constellation is a SEPARATE product from Looper** (`../loop-engineering`), which is untouched.
Do not import Looper code or reference it in this repo; it is a different codebase.

---

## 2. Where the project is right now (2026-08-05, commit `70e81a1`)

The **platform layer is strong and the agentic engine is real and proven.** Condensed; full
per-round evidence with SHAs lives in `MASTER_PLAN.md §9`.

**Platform (built, tested, several parts live-proved):**
- Plugin SDK v0.2 (Zod manifest v2, lifecycle, tools, memory, `requiresApproval`), loader with
  topological ordering + failure isolation, per-plugin Postgres schemas via Prisma.
- Auth: local JWT + OIDC composite verifier (real Keycloak RS256 → 200, tampered → 401, proven).
- RBAC/ABAC (colon-scoped, wildcard), audit incl. denials.
- Federation: `config/modules.yaml` → `/api/federation/*`, Caddy proxy, 11-container Compose
  overlay booted healthy once (Keycloak, Grafana, Prometheus, Loki, Steel, …).
- Brain: Graphify sidecar over MCP, real repo graph (~1400+ nodes), grounded query proven.
- Portal: Next.js App Router — modules, admin, login, `/tools` tiles, `/brain`, `/engine`.

**The agentic engine (the headline work):**
- **Engine v0** — durable BullMQ task queue, Ollama model runtime, ReAct agent loop,
  checkpoint-per-step, REST API, portal page. Kill-restart survival proven live.
- **Engine v0.1 — Harden & Gate** — boot-with-no-infra degradation restored; **human-in-the-loop
  approval gate** (pause → approve/reject, honour-once, audited); honest **`ModelProvider`
  interface** (Ollama is the first impl; a second slots in without touching callers); **per-task
  token budget cap**; D-2 portal identity fix; transient-error retry; Redis-util dedupe.
- **Engine v0.2 — Prove It For Real** — an agent task **called a real tool against the live Brain
  graph, got real data, and completed on it**; approval→execute-once proven with a tool that
  really ran; kill-restart proven *across* a tool call (no double-execute); `/engine` portal
  browser-verified (15 screenshots); `AgentWorkerService` unit-tested.
- **Engine v0.3 — Real Model Providers** — second `ModelProvider`: OpenRouter (one key unlocks
  GPT-OSS/Qwen/DeepSeek/Claude/…); `ModelRouterService` upgraded to REAL routing + fallback
  (`canHandleModel` selection; non-default failure → Ollama with DEFAULT_MODEL); **cost-aware
  budget** (`ModelUsage.costUSD` carries real pricing data); **proven LIVE both ways** — cloud
  task (`openai/gpt-oss-120b`) completed on real tool data with `provider:\"openrouter\"` honestly
  recorded, and with NO key the engine stays $0/local (everything falls back to Ollama, nothing
  crashes). Ollama remains the $0 default; cloud is opt-in per task via the `model` field.
- **Engine v0.4 — Scheduler / Autonomous Triggers** — recurring (cron) + event-triggered schedules
  that **auto-enqueue tasks** (the "runs while you sleep" capability): a `ScheduledTask` Prisma
  model, a zero-dep hand-rolled 5-field cron parser, a `SchedulerEngineService` poll loop + EventBus
  event listeners (graceful disabled-engine degradation), and a REST controller; **proven LIVE** — a
  `* * * * *` cron schedule auto-enqueued a system-authored task that completed on local Ollama,
  `runCount` advanced autonomously across consecutive minutes, DELETE + 404 verified.
- **Engine v0.5 — Deeper 24/7 Reliability** — structured **dead-letter** trail (classified failures),
  a **supervisor** that detects + recovers stuck tasks, and **event-based alerting** (all observable
  via `/api/engine/health` + `/deadletters` + `/alerts`); **proven LIVE** — a stale task was flagged
  + recovered then completed; a re-stale task became a `stalled` dead letter.
- **Platform hardening v0.6** — a **`viewer` non-admin user seed** (RBAC 403 path now live-testable),
  **per-plugin Postgres schema bootstrap** (C8), and **httpOnly-cookie token auth** closing the
  localStorage XSS caveat (login sets an httpOnly SameSite=Lax cookie; the guard falls back to it,
  bearer flow untouched); **proven LIVE** — cookie-only `/api/auth/me` works, viewer gets 403 on
  admin-only routes.

**Gates at `70e81a1`:** lint/build/typecheck all green; **695 tests** (api 571, browser-use 47,
graphify 40, sdk 21, cli 16). Tree clean. **Nothing has ever been pushed. No cloud. ≈$0.00004
spent** (the DeepSeek live proofs). **PHASE 2.0 COMPLETE** (migrations + metrics `ac2cf11`,
CLI `e8fe871`, OTel/Tempo `8d29e3f`, /health dashboard `0647666`, SSO round-trip `4d55928`,
DeepSeek provider `2d813de`, plugin sandboxing `5f268f3`, worker as separate process
`3b37129`, Grafana dashboard + engine-metrics wiring `0127ce1` — all live-proven). **PHASE 3.0
COMPLETE** — /engine task UI (3.1) `b6e379f`, plugin marketplace (3.2) `6e596af`,
visual workflow builder (3.3) `9e05c7a` + `6d23314`, notification center (3.4) `35a76fe`,
notification channels + SMTP (3.5) `88944b7` + `359ece8`, multi-model compare (3.6) `f2afda4`,
workflow trigger wiring `ee5b304` + `4b426f8` (autonomous incident-response primitive),
team spaces (3.7) `418c0d8` + `7216f45` — all live-proven. **Phase 4.0 slices**: MCP server
`609da8a`, compliance export `518a5b3`, brain-page UX + docs-mode RAG `70e81a1`.
**Next: multi-agent crews (4.1), skill marketplace (4.4), federated mesh (4.6), MCP client
side, pgvector/Chroma retrieval, PDF reports.**

**Maturity, honestly:** platform ≈ 3.6/5, agentic engine now ≈ 2.8/5 (was 0.7 before these
rounds). See `SUPER_SESSION_SUMMARY.md` for the full independent review that kicked off the
engine work.

---

## 3. The roadmap ahead (the direction to keep steering)

> **The comprehensive new strategic roadmap lives in `MASTER_PLAN.md §7-BIS`** — read it
> for the full vision: what we initially planned, what we actually built, the market
> landscape analysis, the Phase 2.0/3.0/4.0 feature tables with competitor benchmarks,
> the target architecture diagram, the "top-tier platform" scorecard, and the immediate
> next actions. This section is the condensed execution summary.

In priority order. A new driver should generally continue from here unless the user redirects.

1. ~~**Engine v0.3 — Real Model Providers.**~~ **DONE (git `3d7d635` → `7f12115`, 2026-08-03).**
   OpenRouter as second ModelProvider; real routing + fallback; cost-aware budget (costUSD flows
   through); proven LIVE both ways (cloud E2E + no-key → Ollama fallback). 412 tests.
2. ~~**Engine v0.4 — Scheduler / autonomous triggers.**~~ **DONE (git `f70b573`, 2026-08-03).**
   Recurring (cron) + event-triggered schedules auto-enqueue tasks. Proven LIVE (auto-enqueue →
   Ollama-complete, runCount advanced autonomously). 481 tests.
3. ~~**Engine v0.5 — Deeper 24/7 reliability.**~~ **DONE (git `ec88534`, 2026-08-03).** Dead-letter
   handling, supervisor for stuck tasks, event-based alerting. Proven LIVE (stale task recovered;
   re-stale task became a `stalled` dead letter). 505 tests.
4. **Phase 2.0 — Production Foundation (COMPLETE as of `0127ce1`):** migrations ✅ (`ac2cf11`), OTel tracing ✅ (`8d29e3f`), Prometheus `/api/metrics` ✅ (`ac2cf11`), CLI ops ✅ (`e8fe871`), portal `/health` dashboard ✅ (`0647666`, browser-proven), real SSO round-trip ✅ (`4d55928`), plugin sandboxing ✅ (`5f268f3`), worker as separate process ✅ (`3b37129`), **Grafana dashboard JSON + engine-metrics wiring ✅ (`0127ce1`)**.
5. **Phase 3.0 — Platform as a Product (COMPLETE as of `7216f45`):** **portal full `/engine` task UI (3.1, P0) ✅ (`b6e379f`)**; **plugin marketplace (3.2) ✅ (`6e596af` — browse/install/uninstall with hot-reload, browser-proven)**; **visual workflow builder (3.3) ✅ (`9e05c7a` + typecheck fixup `6d23314` — Workflow/WorkflowRun + migration, definition validator + {{steps.<id>.result|error}} templating, run executor over engine queue + plugin invoke, drag-reorder builder UI with live run trail, browser-proven)**; **notification center (3.4) ✅ (`35a76fe` — durable event feed from engine alerts + NEW scheduler emissions, REST list/read/dismiss, portal /notifications + sidebar unread badge + admin audit-log tab; all 5 event topics LIVE-PROVEN + browser-proven)**; **notification channels + email (3.5) ✅ (`88944b7` webhooks + `359ece8` SMTP — envelopes, per-kind filters, Test, completed/paused events, portal Channels tab; LIVE-PROVEN vs local listener + SMTP stub)**; **multi-model compare (3.6) ✅ (`f2afda4` — usage/cost persisted per task + portal /compare, LIVE-PROVEN ollama vs deepseek)**; **workflow trigger wiring ✅ (`ee5b304`+`4b426f8` — cron/event triggers actually fire workflows; = autonomous incident-response primitive, LIVE-PROVEN)**; **team spaces (3.7) ✅ COMPLETE (`418c0d8` API + `7216f45` portal — Org/Team/TeamMember + /api/teams RBAC + /me teams + AgentTask.teamId scoping + /teams page, browser-proven)**. **Deployment** — VPS via Coolify. **BLOCKED on the user**: provider + monthly budget (D1). Prove everything locally first; no cloud without explicit approval + confirmed cost.

Known non-blocker gaps carried in `HANDOFF.md §8/§11`: checkpoint O(n²) write volume (DECIDED-KEEP, raw-SQL fix noted); **brain-page fixes — DONE this pass (`70e81a1`)**; **docs-mode brain indexing — DONE this pass (`70e81a1`)**;
open-webui/langflow tiles never booted; 17 pre-existing web lint warnings; mid-invoke at-least-once
window (by design).

---

## 4. How Polaris drives — the operating method (this is the real inheritance)

These disciplines, not any single feature, are why the project has stayed coherent. Hold them.

1. **Verify before "done." Re-run; don't trust a claim — including your own.** Nothing is complete
   until it builds + typechecks + lints + tests + (where relevant) boots. The maker/checker split
   is sacred: an agent makes, the orchestrator independently checks.
2. **Live proof beats green gates — every single round has proven this.** Green gates passed while
   the real thing was broken, *repeatedly*: the greedy-regex parser bug, the `import type` DTO bug
   that silently disabled request validation, the Graphify `isError:false` dishonest-success, the
   missing `ioredis` optional-peer-dep, the `Prisma.DbNull`-vs-JSON-null round-trip. **If a feature
   is observable, prove it live and paste the literal evidence into `MASTER_PLAN.md §9`.** Assume a
   feature you haven't run live does not work yet.
3. **Disjoint lanes.** Atlas/Nova/Orion own non-overlapping file trees (`HANDOFF.md §6`). Keep them
   disjoint so parallel work never collides. Greenfield additions parallelize; live-verification
   rounds against one dirty tree do **not** — those are single-threaded by nature (one writer, one
   committer, live gates). Learned the hard way.
4. **One orchestrator commits. Agents never run git and never claim commit/build state** — they
   can't see it, and they've mislabeled committed work "uncommitted" before. Agents report; you
   verify and commit.
5. **Document every task the moment it's verified** — not batched. `MASTER_PLAN.md §9` (what
   shipped, what was verified incl. live/DB, the **SHA**), `HANDOFF.md §3` (status) + `§8`
   (pending→done). The SHA-backfill commit convention (a doc commit right after the code commit
   carrying its SHA) keeps the log self-referential. This discipline is why the user gets live
   progress by reading the docs instead of interrupting the driver.
6. **Honesty is a hard requirement.** Record UNRUN gaps explicitly. Never claim what wasn't
   verified. "Green offline, not run live" is a valid, respected status — silent overclaiming is not.
7. **Scope discipline.** One coherent round at a time. Defer breadth (the original brief has ~30
   enterprise deliverables) so the load-bearing thing — the engine — never starves. Name deferrals
   as P4, don't chase them.
8. **The standing safety rules, always** (`HANDOFF.md §1`): **$0 / local only** — no cloud, no paid
   services without explicit user approval + confirmed cost. **Never `git push`** without an
   in-the-moment go-ahead (local commits are expected). **Never commit secrets** — `.env` is
   git-ignored; keep it that way; API keys and the like live only in `.env`. **Prisma `db push`
   only against the disposable LOCAL dev DB**, with `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`
   set (the user granted standing consent for local dev DBs only).
9. **The SDK is load-bearing.** `packages/plugin-sdk` is the contract everything plugs into. Evolve
   it deliberately and additively, bump `manifestVersion`, and call the change out in the docs.

---

## 5. The team & how to drive them

- **clau_partner** — co-orchestrator / backup lead. Takes the identical role when Polaris is
  unavailable, follows the same rules, and is the one who has driven several recent solo rounds
  (Engine v0.1, v0.2). When both are active, **only ONE orchestrates at a time** to avoid
  clobbering. clau_partner can be handed a whole round with a self-contained prompt and will
  execute maker/checker discipline, commit per task, and update the docs — treat their reports as
  trustworthy but still spot-verify (the user has consistently asked Polaris to independently
  re-run gates after each round, and it's caught nothing dishonest but has kept the bar high).
- **Atlas** — infra/data lane: `apps/api/src/core/{database,logging,settings,events,auth,rbac,
  audit}`, `apps/api/prisma`, `app.module.ts`, `infra/**`, Docker/Compose/CI.
- **Nova** — SDK/core-plugins/capabilities lane: `packages/**`, `apps/api/src/core/plugins/**`,
  `apps/api/src/core/engine/**`, new `plugins/<capability>/**`.
- **Orion** — portal/DX lane: `apps/web/**`, docs *except* the orchestrator-only ones.

**The loop:** assign a tightly-scoped, self-contained prompt (include file paths, acceptance
criteria, the host gotchas, and "report back, don't touch the orchestrator docs, don't run git")
→ they work → they report → **you** integrate, verify live, commit, and document. The user is the
courier between sessions when the agents run as separate CLI sessions; write prompts the user can
paste verbatim.

---

## 6. Skills the driver needs (what it takes to hold this seat)

- **Stack fluency:** TypeScript (strict), NestJS (DI, guards, `@Optional()`, `APP_GUARD`,
  `emitDecoratorMetadata` gotchas), Next.js App Router (server vs `"use client"`), Prisma 7
  (driver adapters, multi-schema, `DbNull`), BullMQ + ioredis, Zod, Vitest.
- **Systems judgment:** durable queues, checkpointing/resume, idempotency, at-least-once vs
  exactly-once, graceful degradation (the "boot with no infra" invariant), provider abstraction.
- **Security instinct:** least-privilege, human-in-the-loop approval gates, secrets hygiene,
  RBAC/ABAC, audit — and the reflex to *not* hand an autonomous agent `platform:admin`.
- **Verification rigor:** the maker/checker reflex, reading a diff critically, designing a live
  acceptance test that would actually fail if the feature were broken, and distinguishing "test
  passes" from "feature works."
- **Operational literacy on THIS host** (see `HANDOFF.md §3` for the full list): the `pnpm` shim
  is broken but pnpm itself works via a direct native-path invocation; **always `turbo --force`**
  (cache reports false greens) and **`--concurrency=1`** (parallel runs collide); **Redis is on
  :6380**, not 6379; **Ollama** is native with `qwen2.5-coder:1.5b`/`7b` (not `llama3.2`); **port
  4000 is squatted** by another product — boot the api on **:4001**; kill a stale port squatter
  with `Get-NetTCPConnection -LocalPort <p> -State Listen | ForEach-Object { Stop-Process -Id
  $_.OwningProcess -Force }`; `make` is not installed (run the underlying `docker compose` commands).
- **Communication:** condensed, honest status to the user; self-contained prompts to the agents;
  and keeping the docs so current that anyone can resume from them cold.

---

## 7. How to take the wheel (literal onboarding for a new driver)

1. **Read, in order:** this file → `MASTER_PLAN.md` (vision, locked decisions C1–C10, roadmap §7,
   task split §8, verification log §9) → `HANDOFF.md` (§3 current status, §5 the two never-regress
   bugs, §6 lanes, §7 how to verify, §8 pending). Skim `SUPER_SESSION_SUMMARY.md` for the
   independent architecture review, `BRAIN.md` and `PLUGIN_SDK.md` for those subsystems.
2. **Confirm the state is what the docs say:**
   ```
   cd C:/Users/<user>/Claude/Code/constellation
   git log --oneline -15 && git status        # expect clean, HEAD matches the docs
   cd apps/api && ./node_modules/.bin/prisma generate && cd ../..
   ./node_modules/.bin/turbo run lint build typecheck test --force --concurrency=1
   ```
   Expect all tasks green and the test count in §2 above. If it doesn't match, the docs are stale —
   reconcile before doing anything else.
3. **Introduce yourself to the user**, confirm the next round (default: Engine v0.3 — Real
   Providers, §3 above), and continue the operating method in §4. Update `HANDOFF.md §0` and this
   file's header with your name if you are not continuing as Polaris.
4. **Never** push, provision cloud, spend money, or commit a secret without the user's explicit
   in-the-moment go-ahead. When in doubt, ask the user — they are the product owner and final
   decision-maker.

---

*Polaris out. The star doesn't move; it just keeps pointing north so the rest of the sky makes
sense. Whoever holds this seat next: keep it honest, prove it live, and leave the docs so clean
that the next hand can steer from them cold.*
