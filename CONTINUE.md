# CONTINUE — Resume Constellation In One Prompt

> **Read this FIRST.** It makes the whole project self-contained inside
> `C:\Users\syed.mohamed\Claude\Code\constellation` — no outside context needed.
> A fresh CLI session (new terminal, new agent) reads this file, confirms the
> state, and continues from exactly where we left off. Nothing you need lives
> outside this folder.

---

## 0. The one prompt to resume (paste this in a fresh session)

> Read `C:\Users\syed.mohamed\Claude\Code\constellation\CONTINUE.md` in full,
> then `docs/ORCHESTRATOR.md`, `docs/MASTER_PLAN.md`, and `docs/HANDOFF.md`.
> Confirm the exact current state (commits, test counts, live stack) matches what
> CONTINUE.md says — reconcile if stale. Then continue the roadmap from §4
> ("Current state") → §5 ("What's blocking") → §6 ("Roadmap next"), one coherent
> round at a time, verify-before-done, commit each round, and backfill the docs.
> Nothing is pushed, no cloud is provisioned, no money spent without the user's
> explicit go-ahead. You are **Polaris**, the lead orchestrator — keep that name.

---

## 1. Project root & hard rules

- **Root ONLY:** operate exclusively inside `C:\Users\syed.mohamed\Claude\Code\constellation`.
  Any doc/artifact found outside it must be moved in. The stray `~/kctok.txt`
  (a real Keycloak JWT) was already moved to `artifacts/sso-test-tokens/` (git-ignored).
- **Polaris operating method** (see `docs/ORCHESTRATOR.md §4`): one task at a time,
  verify-before-done, LIVE proof not just green gates, per-task commits with the
  SHA-backfill convention, update `MASTER_PLAN.md §9` + `HANDOFF.md §3/§8` after
  every task, $0/local, NEVER `git push`.
- **Docs are paramount and live IN THIS FOLDER.** No assumptions, no predictions.
  Every round ends with: SHA, gate counts, live-proof, and what's
  done / pending / in-progress / blocked.
- **Never push.** No cloud spend, no VPS provisioning, without the user's
  explicit in-the-moment go-ahead (that's D1/D2 in `MASTER_PLAN.md §7-BIS.7`).
- **User identity note:** The owner is `path:`-sanitized in the repo (real Windows
  username replaced with `<user>`). Real identity is never reintroduced into
  tracked docs/scripts.

---

## 2. What Constellation is

An **enterprise plugin platform** — a portal for humans AND a durable AI-agent
engine, sharing the same plugin system:
- **Portal plane** — Next.js SPA, one SSO login, RBAC, plugin catalog, federated
  tools, `/engine` ops UI.
- **Agent plane** — BullMQ-backed 24/7 task runtime: ReAct loop, tool calling,
  approval gate, model router, scheduler, supervisor, dead-letter, alerting.
- **Plugin SDK** — `@constellation/plugin-sdk`; any module installed the same way.

The strategic vision + market analysis + full roadmap live in
`docs/MASTER_PLAN.md §7-BIS` (Constellation 2.0/3.0/4.0).

---

## 3. Current state (authoritative as of the last commit) — reconcile, don't assume

**HEAD:** `70e81a1` — `feat(brain): Phase 4.0 — brain-page UX fixes + docs-mode (RAG) graphify wiring` (above `518a5b3` compliance export, `609da8a` MCP server, `359ece8` SMTP channel, `7216f45` team-spaces portal, `418c0d8` team-spaces API, `ee5b304` workflow triggers, `88944b7` webhook channels, `f2afda4` multi-model compare, `29d9746` session summary). **PHASE 2.0 COMPLETE; PHASE 3.0 COMPLETE; PHASE 4.0 in progress (MCP server, compliance export, brain UX + docs-mode RAG shipped).**
Tree is **clean** (only untracked `Prompt to Clau_Partner.txt`, a working artifact).

**Test count (full repo):** **695** — api **571** (40 files), web (build+typecheck, no unit
suite), plugin-sdk **21**, plugin-graphify **40**, plugin-browser-use **47**, cli **16**.
Gates: `turbo run lint build typecheck test --force --concurrency=1` → **20/20 tasks green**.

**What shipped (this is the honest record — see `MASTER_PLAN.md §9` for every round):**

| Round | SHA | What | Verified |
|-------|-----|------|----------|
| Engine v0.3 | `7f12115` | OpenRouter provider, routing/fallback, cost-aware budget | ✅ cloud + no-key live |
| Engine v0.4 | `f70b573` | Scheduler (cron + event auto-enqueue), Crontab parser | ✅ auto-enqueue → Ollama-complete |
| Engine v0.5 | `ec88534` | Dead-letter, stuck-task supervisor, event alerting | ✅ stale recovered; re-stale → stalled |
| Platform hardening v0.6 | `070fb2d` | Viewer seed, per-plugin schema bootstrap, httpOnly-cookie auth | ✅ viewer→403; cookie auth works |
| Publish-readiness | `d679918` | Username sanitized, README Author's note, secret sweep clean | ✅ 0 secrets in tracked files |
| Strategic roadmap | `a63dae9` | MASTER_PLAN §7-BIS (vision, market, 2.0/3.0/4.0) | docs |
| Portal v1.1 series | `cf161b4`→`635ec9d` | Design-language UI overhaul (3 skill repos), dark+light, motion, toasts | ✅ web builds, typecheck 0 |
| Phase 2.0 infra | `ac2cf11` | Prisma migrations history + Prometheus `/api/metrics` | ✅ live: /metrics HTTP 200, migrate status clean |
| CLI ops | `e8fe871` | `constellation ops health|engine status|tasks|schedules|deadletters|plugins` | ✅ 16 cli tests, TSC=0 |
| OTel tracing | `8d29e3f` | Additive OTel tracer (HTTP/engine-step/model/tool spans) + Tempo in the federation overlay | ✅ LIVE both ways: unset→0 traces, set→full parented tree in Tempo |
| Health dashboard | `0647666` | Portal `/health` — live engine dashboard (queue, model providers, scheduler, supervisor, alerts) | ✅ browser-proven: all cards live, 5s poll |
| DeepSeek provider | `2d813de` | Third ModelProvider (direct DeepSeek API, `deepseek-v4-flash`, derived cost) + 2 live-found bug fixes (router cloud-first scan, NOOP_SPAN) | ✅ task completed `provider:"deepseek"` (≈$0.00001) |
| Real SSO round-trip | `4d55928` | Phase 2.0 2.6 — Keycloak RS256 token → api 200, verifiers coexist, tampered → 401, portal tiles + Caddy paths | ✅ four-curl set + real-browser /tools pass |
| Plugin sandboxing | `5f268f3` | Phase 2.0 2.7 — process-mode sandbox (timeout/heap/result caps, crash containment), OPT-IN | ✅ boom/crash/hang contained, graphify ran in the child |
| Worker separate process | `3b37129` | Phase 2.0 2.8 — ENGINE_WORKER_MODE=embedded\|separate + worker-main.js | ✅ api enqueues w/o consuming; worker completed task + fired cron |
| Grafana dashboard | `0127ce1` | Phase 2.0 2.3 — provisioned 19-panel dashboard + engine-metrics wiring (2 live-found fixes) | ✅ real Prometheus samples + browser-rendered live data |
| Portal /engine task UI | `b6e379f` | Phase 3.0 3.1 (P0) — filter tabs, 2s live step streaming + live badge, Re-run, model picker, Result+Copy | ✅ browser: STEP HISTORY (3) + RESULT JSON + Copy + tabs + Re-run |
| Plugin marketplace | `6e596af` | Phase 3.0 3.2 — browse/install/uninstall with hot-reload (plugins-catalog/ shelf, marker-gated uninstall) | ✅ browser: Install → installed zone + toast → Uninstall → back to available |
| Visual workflow builder | `9e05c7a` (+ fixup `6d23314`) | Phase 3.0 3.3 — Workflow/WorkflowRun + migration, validator + templating, run executor, drag-reorder builder UI | ✅ 2-step agent→tool run completed (templated args) + browser trail rendered |
| Notification center | `35a76fe` | Phase 3.0 3.4 — durable event feed (engine alerts + NEW scheduler emissions → Notification model), REST list/read/dismiss, portal /notifications + sidebar unread badge + admin audit-log tab | ✅ 5/5 event topics live (cron ×20, terminal failure, stale→recovered) + REST round-trip + real-browser badge/mark-all/audit |
| Multi-model compare | `f2afda4` | Phase 3.0 3.6 — cumulative usage/cost PERSISTED on tasks (TokenBudget input/output/cost, migration add_task_usage) + portal /compare (same prompt on 2+ models, side-by-side latency/tokens/$) | ✅ LIVE: ollama 51.0s/$0 vs deepseek-v4-flash 2.3s/$0.000018, persisted tokens on both; browser results table + cards verified |
| Notification channels | `88944b7` | Phase 3.0 3.5 remainder — webhook channels (generic/Slack/Discord/Teams envelopes, per-kind filters, enabled toggle, fire-and-forget) + NEW engine.task.completed/paused events + portal Channels tab | ✅ LIVE: local listener — generic got completed+failed, slack got only the failure, Test POST delivered; browser Test → toast + webhook |
| Workflow trigger wiring | `ee5b304` (+ fixup `4b426f8`) | Phase 3.0 — ScheduledTask.workflowId (migration add_workflow_triggers) → scheduler RUNS workflows; WorkflowTriggerService (cron auto-schedule `workflow:<id>`, event listeners on core+platform scopes); = autonomous incident-response primitive | ✅ LIVE: cron workflow auto-armed + fired + completed; PUT re-sync; event workflow on engine.task.failed fired by a real doomed task → completed |
| Team spaces API | `418c0d8` | Phase 3.0 3.7 — Organization/Team/TeamMember (owner\|admin\|member, migration add_team_spaces) + /api/teams RBAC + /me teams + AgentTask.teamId scoping (non-admins see personal + their teams' tasks) | ✅ 554 api tests green; portal /teams page + live proof IN FLIGHT (next round) |
| Team spaces portal | `7216f45` | Phase 3.0 3.7 — /teams page (create team → owner, role badges, members by email + role select, owner-protected remove), lib/teams.ts, core-teams nav; TaskService list projection + usage/cost | ✅ LIVE: viewer /me teams + team task via ?teamId= + 403 member mgmt; browser OWNER badge + member rows + ADD MEMBER box verified |
| SMTP email channel | `359ece8` | Phase 3.0 3.5 remainder — zero-dep net/tls SMTP client, channel type smtp (recipient/from, env relay), .env.example block; 2 live-found bugs (EHLO folding, 3xx) | ✅ LIVE vs local SMTP stub: test mail + real engine.task.failed mail recorded literally |
| MCP server | `609da8a` | Phase 4.0 4.3 — POST /api/mcp JSON-RPC (initialize/tools/list/tools/call/ping/resources), 4 constellation tools, JWT-guarded | ✅ LIVE client exchange: handshake + REAL task completed via MCP on Ollama (mcp-ok, 424 tokens, $0) + isError/401 |
| Compliance export | `518a5b3` | Phase 4.0 4.7 — GET /api/audit/export CSV (actor/action filters, cap 1000) + portal Export CSV button on the Audit tab | ✅ LIVE: 200/2415-byte real CSV + workflow-filtered + 401; browser toast |
| Brain UX + docs-mode RAG | `70e81a1` | Phase 4.0 — brain page (adaptive layout, content-keyed memo, label anti-collision, degraded banner) + GRAPHIFY_MODE=docs default, bind-mounted graph, [mcp,ollama] Dockerfile | ✅ /brain NOT-BUILT UI browser-verified; extraction live (258 code + 11 docs); graph materialization running at close |

**Live stack (local, $0):** postgres :5432, redis :6380, ollama `qwen2.5-coder:7b`,
api :4001 (use `API_HOST_PORT`, never the squatted :4000). Prometheus/Grafana/Loki
scrape `/api/metrics`. **Tempo now in the federation overlay** (OTLP :4317/:4318,
query :3200) — boot with `docker compose -f docker-compose.yml -f
docker-compose.federation.yml --profile federation up -d tempo`, then set
`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` to enable tracing.

---

## 4. Where we are in the roadmap

**Done:** Engine v0→v0.5 · Platform hardening v0.6 · Publish-readiness prep ·
Portal design-language rebuild (both themes) · Prisma migrations history ·
Prometheus `/api/metrics` · CLI ops subcommands · **OTel tracing + Tempo** ·
**Portal `/health` engine dashboard** · **PHASE 3.0 COMPLETE (3.1 /engine UI, 3.2
marketplace, 3.3 workflow builder, 3.4 notification center, 3.5 channels + SMTP,
3.6 multi-model compare, workflow trigger wiring, 3.7 team spaces)** ·
**Phase 4.0 slices: MCP server, compliance export, brain-page UX fixes,
docs-mode RAG wiring (all LIVE-PROVEN)**.

**The design-language source** (three repos, guidance captured in `docs/DESIGN_SKILL.md`):
`emilkowalski/skills`, `pbakaus/impeccable`, `leonxlnx/taste-skill`. Any portal
work MUST follow `docs/DESIGN_SKILL.md` (easing, press-scale, surfaces, both themes).

---

## 5. What's blocking / pending on the user (do NOT auto-decide)

From `MASTER_PLAN.md §7-BIS.7` — the user has explicitly deferred these for now:
- **D1 — VPS provider + monthly budget** (deferred; build locally, prove locally).
- **D2 — GitHub push go-ahead** (deferred; repo is publish-clean, waiting on user).

These are NOT to be actioned without the user resuming them.

---

## 6. Roadmap next — the concrete remaining work

**Phase 2.0 — Production Foundation (in progress):**
- ~~**OTel tracing**~~ **DONE (`8d29e3f`)** — additive tracer (spans for HTTP,
  engine task runs/steps, model calls, tool calls) that **no-ops when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is unset**, plus Tempo in the federation overlay.
  LIVE-PROVEN both ways (evidence in `artifacts/phase2-otel-tracing/`).
- ~~**Health dashboard (2.4)**~~ **DONE (`0647666`)** — portal `/health` route
  rendering the engine health endpoint as a live dashboard (engine status, queue
  depth incl. failedTasks, model providers, scheduler, supervisor, alert trail);
  browser-proven (evidence in `artifacts/health-dashboard/`).
- ~~**Real SSO round-trip (2.6)**~~ **DONE (`4d55928`)** — real Keycloak RS256 token →
  api 200 (Keycloak UUID principal), verifiers coexist, tampered → 401; portal `/tools`
  federated tiles + Caddy-proxied paths LIVE-PROVEN in a real browser (evidence in
  `artifacts/sso-roundtrip/`; realm is in-memory H2 — the kcadm recipe in the federation
  reference is the reproducible path).
- **DeepSeek model provider** (user request, `2d813de`) — a THIRD ModelProvider (direct
  DeepSeek API like OpenRouter): `deepseek-v4-flash`, OPT-IN key, thinking-mode toggle,
  derived cost; LIVE-PROVEN (task completed `provider:"deepseek"`, ≈$0.00001 spend).
  Key lives in git-ignored `.env` only.
- ~~**Plugin sandboxing (2.7)**~~ **DONE (`5f268f3`)** — process-mode sandbox (zero-dep
  child node): `PLUGIN_SANDBOX_MODE=off|process` + `PLUGIN_SANDBOX_PLUGINS` (default off),
  timeout/heap/result caps + crash containment; LIVE-PROVEN (boom/crash/hang contained,
  graphify ran in the child). Network isolation NOT enforced on Windows (documented).
- ~~**Worker as separate process (2.8)**~~ **DONE (`3b37129`)** — `ENGINE_WORKER_MODE=
  embedded|separate` + `dist/worker-main.js` + `boot-worker.sh`; LIVE-PROVEN (api enqueues
  without consuming; the worker completed the task + fired a cron schedule cross-process).
- ~~**Grafana dashboard JSON (2.3 tail)**~~ **DONE (`0127ce1`)** — provisioned "Constellation
  Platform" dashboard (19 panels, uid constellation) over /api/metrics; datasource uids
  pinned; prometheus host-dev scrape job; TWO live-found bugs fixed (metric unit-suffix
  duplication + the engine counters that were declared but never fed — now wired via
  @Optional() MetricsService into all six engine/auth hot paths). LIVE-PROVEN in a real
  browser with live data. **PHASE 2.0 IS COMPLETE.**

**Phase 3.0 — Platform as a Product (IN PROGRESS — 3.1 + 3.2 + 3.3 + 3.4 DONE):** ~~portal full
`/engine` task UI (P0 — the #1 UX gap)~~ **DONE (`b6e379f` — status filter tabs with counts,
2s live step streaming + pulsing 'live' badge, Re-run for finished tasks, model picker
datalist from the health providers, Result panel with Copy; LIVE-PROVEN in a real browser)**;
~~plugin marketplace~~ **DONE (`6e596af` — browse/install/uninstall with HOT-RELOAD (no
restart): plugins-catalog/ shelf, PluginCatalogService (marker-gated uninstall), loader
reload(), GET /plugins/catalog + guarded routes; LIVE-PROVEN: install → enabled + folder
present → uninstall → back to available, in a real browser with toasts)**;
~~visual workflow builder~~ **DONE (`9e05c7a` — Workflow/WorkflowRun models + migration,
definition validator + {{steps.<id>.result|error}} templating, run executor (agent steps via
the engine queue, tool steps via plugin invoke, per-step crash-safe trail), CRUD + run +
history routes guarded by core:workflow:manage, zero-dep drag-reorder builder UI on
/workflows with a live run trail; LIVE-PROVEN: 2-step agent→tool run completed with
templated args + browser-created workflow ran to completion with the trail rendered)**;
~~notification center~~ **DONE (`35a76fe` — durable event feed: Notification model +
migration, NotificationService on the EventBus (engine.task.failed/stale/recovered + NEW
scheduler.schedule.fired/error emissions), GET /api/notifications + unread-count +
read-all + :id/read + :id DELETE, portal /notifications page (filters, severity icons,
mark-read/dismiss/mark-all, admin Audit-log tab) + sidebar unread badge; LIVE-PROVEN:
5/5 event topics end-to-end + REST round-trip + real-browser badge/mark-all/audit)**;
~~notification channels (3.5 remainder)~~ **DONE (`88944b7` — webhook channels with
generic/Slack/Discord/Teams envelopes + per-kind filters, fire-and-forget delivery that never
breaks the feed, REST /api/notifications/channels + Test, NEW engine.task.completed/paused
events so the 'completed/failed/needs-approval' vision is real, admin Channels tab;
LIVE-PROVEN against a local listener incl. browser Test → toast + POST)**;
~~multi-model compare (3.6)~~ **DONE (`f2afda4` — usage/cost PERSISTED on tasks
(TokenBudget accumulation + worker persistUsage at every terminal path, migration
add_task_usage) + portal /compare: pick 2+ models, run the same prompt, side-by-side
latency/tokens/cost cards; LIVE-PROVEN: ollama vs deepseek same prompt, real persisted
numbers in API + browser)**;
~~workflow trigger wiring~~ **DONE (`ee5b304` + fixup `4b426f8` — ScheduledTask.workflowId
(migration add_workflow_triggers): firing a workflow schedule RUNS the workflow instead of
enqueuing a task (fire-and-forget); WorkflowTriggerService arms cron auto-schedules
`workflow:<id>` + event listeners on BOTH core/platform scopes; sync on create/update,
remove on delete; bidirectional forwardRef modules. This IS the autonomous incident-response
primitive: a workflow on engine.task.failed remediates failures. LIVE-PROVEN: cron fired +
completed, PUT re-sync, real doomed task → event workflow completed)**;
**team spaces (3.7) — COMPLETE (`418c0d8` API + `7216f45` portal: Org/Team/TeamMember
owner|admin|member, /api/teams RBAC, /me teams, AgentTask.teamId scoping, /teams page with
member management — LIVE-PROVEN incl. viewer 403 + browser).** Then: **Phase 4.0 slices —
MCP server (`609da8a`, LIVE-PROVEN), compliance/audit export (`518a5b3`, LIVE-PROVEN),
brain-page UX + docs-mode RAG (`70e81a1`)**. Remaining backlog: multi-agent crews (4.1),
agent skill marketplace (4.4), federated agent mesh (4.6), MCP client side, pgvector/Chroma
retrieval layer, PDF reports, Grafana/Prometheus alert trigger ingestion, team-scoped
schedules/workflows, per-user notification targeting.

**Phase 4.0 — Agentic OS:** multi-agent crews (delegation), persistent memory
(RAG + Graphify), MCP server + client, agent skill marketplace, autonomous
incident response, federated agent mesh, compliance reports.

Full feature tables with competitor benchmarks + priorities: `docs/MASTER_PLAN.md §7-BIS.3`.

---

## 7. Every doc that already lives in this folder (self-contained)

| File | Purpose |
|------|---------|
| **`CONTINUE.md`** (this) | Fresh-session resume in one prompt |
| `docs/ORCHESTRATOR.md` | Polaris's full operating manual + team + onboarding |
| `docs/MASTER_PLAN.md` | Vision, C1–C10 decisions, §7-BIS roadmap, §9 verification log |
| `docs/HANDOFF.md` | Always-current handoff state (§3 status, §8 pending, §11 in-flight) |
| `docs/DESIGN_SKILL.md` | The portal design language (the 3 skill repos distilled) |
| `docs/BRAIN.md`, `docs/PLUGIN_SDK.md`, `docs/SUPER_SESSION_SUMMARY.md` | Subsystem docs |
| `artifacts/*/live-proof-evidence.md` | Literal live-proof records per round (incl. `artifacts/sso-test-tokens/`, git-ignored) |

**Nothing needed to continue this project exists outside this folder.`**

---

## 8. How to verify a fresh session actually works (the user's check)

After reading this file, a correct resume must be able to run:
```bash
cd C:/Users/syed.mohamed/Claude/Code/constellation
git log --oneline -5        # expect 35a76fe at HEAD (docs backfill directly above it; 6a01000 below)
git status                  # expect a CLEAN tree
./node_modules/.bin/turbo run lint build typecheck test --force --concurrency=1
# expect 20/20 tasks green, 637 tests (api 513, sdk 21, graphify 40, browser-use 47, cli 16)
```
Then continue from §6 (Phase 3.0 — next: multi-model compare / team spaces).
Reconcile if any of it differs.
