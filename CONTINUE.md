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

**HEAD:** `dd0ff53` — `chore: ignore Python bytecode caches`. Just below it:
`fbd4cf1` (docs backfill for the /health round) and `0647666` (the round itself —
`feat(web): Phase 2.0 — portal /health engine dashboard (2.4)`).
Tree is **clean** (only untracked `Prompt to Clau_Partner.txt`, a working artifact).

**Test count (full repo):** **547** — api **423**, web (build+typecheck, no unit
suite) , plugin-sdk **21**, plugin-graphify **40**, plugin-browser-use **47**, cli **16**.
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
**Portal `/health` engine dashboard**.

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
- **Real SSO round-trip (2.6):** Keycloak + Caddy are IN compose and running;
  prove login → token → portal tile end-to-end (the OIDC seam exists).
- **Plugin sandboxing** (2.7): plugins run in-process today (documented). Optional
  `vm2`/sidecar isolation with resource limits. Enterprise security requirement.
- **Worker as separate process** (2.8): BullMQ worker currently in-process with
  the API. Extract for HA + horizontal scale.

**Phase 3.0 — Platform as a Product (after 2.0):** full engine task UI depth,
visual workflow builder, plugin marketplace, plugin scaffolding + hot-reload,
notification center (task/schedule/approval events → toast/email/slack), multi-
model compare, team spaces.

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
git log --oneline -5        # expect dd0ff53 at HEAD
git status                  # expect a CLEAN tree
./node_modules/.bin/turbo run lint build typecheck test --force --concurrency=1
# expect 20/20 tasks green, 547 tests (api 423, sdk 21, graphify 40, browser-use 47, cli 16)
```
Then continue from §6. Reconcile if any of it differs.
