# Constellation — Installation, Configuration & Deployment

> From a fresh clone to a running platform: local development, the full Docker stack, the
> optional federation/SSO overlay, and production deployment. For architecture see
> [ARCHITECTURE.md](ARCHITECTURE.md); for security hardening see [../SECURITY.md](../SECURITY.md).

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Local development](#2-local-development)
3. [The full Docker stack](#3-the-full-docker-stack)
4. [Configuration reference](#4-configuration-reference)
5. [Enabling AI models](#5-enabling-ai-models)
6. [The Brain (knowledge graph)](#6-the-brain-knowledge-graph)
7. [Federation & SSO overlay](#7-federation--sso-overlay)
8. [Database & migrations](#8-database--migrations)
9. [Production deployment](#9-production-deployment)
10. [The CLI](#10-the-cli)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 22+** | Uses native `fetch`, `AbortSignal.timeout`, WebSocket |
| **pnpm** | `corepack enable` (ships with Node) — pnpm 9.x |
| **Docker + Compose** | For Postgres + Redis and the full stack |
| **Ollama** *(optional)* | Local, $0 AI. `ollama pull qwen2.5-coder:7b` (or any model) |
| **Python + uv/pipx** *(optional)* | Only to build the Graphify knowledge graph locally |

Everything is designed to run **local and $0** — no cloud account, no paid API key is required
to run the platform or the agent engine.

---

## 2. Local development

```bash
git clone https://github.com/Mohamed-Syed/constellation.git
cd constellation
corepack enable
pnpm install
pnpm build            # builds the SDK, CLI, and plugins
```

Run the apps in watch mode:

```bash
pnpm --filter @constellation/api dev     # NestJS core → http://localhost:4000/api
pnpm --filter @constellation/web dev     # Next.js portal → http://localhost:3000
```

Verify:

```bash
curl http://localhost:4000/api/health        # aggregate health
open  http://localhost:4000/api/docs          # Swagger / OpenAPI
open  http://localhost:3000                    # the portal
```

The API **boots with no database at all** — it degrades gracefully and reports it. To exercise
persistence, auth seeding, and the engine, bring up Postgres + Redis (next section).

### The gate (verify before you commit)

```bash
./node_modules/.bin/turbo run lint build typecheck test --force --concurrency=1
# expect 20/20 tasks green, 728 tests
```

> **`--force`** (Turbo's cache can report false greens) and **`--concurrency=1`** (parallel runs
> can collide on this workspace) are recommended — see [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## 3. The full Docker stack

The Compose stack is the closest thing to production: real **PostgreSQL 16 + Redis 7**, the
NestJS core, and the Next.js portal on one network with real healthchecks.

```bash
docker compose up -d --build      # or: make up
curl http://localhost:4000/api/health
docker compose down               # or: make down  (volumes preserved)
```

| Service | URL / Port |
|---|---|
| Portal | http://localhost:3000 |
| Core API | http://localhost:4000/api (`/api/health`, `/api/docs`) |
| PostgreSQL 16 | `localhost:5432` — db/user/pass `constellation` |
| Redis 7 | `localhost:6379` |

Host ports are overridable — useful when something already owns a port:

```bash
API_HOST_PORT=4010 WEB_HOST_PORT=3010 \
  NEXT_PUBLIC_API_URL=http://localhost:4010/api \
  CORS_ORIGINS=http://localhost:3010 \
  docker compose up -d
```

> `NEXT_PUBLIC_API_URL` is inlined into the client bundle at **build** time (a Next.js
> constraint), so changing it requires `--build`, not just a restart.

### Make targets

```
make up        # build + start everything, print URLs      make logs    # tail all services
make down      # stop (volumes preserved)                   make ps      # status + health
make clean     # stop + DELETE the postgres/redis volumes   make migrate # apply Prisma schema
make health    # curl the core health endpoint              make psql    # psql shell
```

Both images build from the **monorepo root** context and run as the **non-root** `node` user.

---

## 4. Configuration reference

Everything is `.env`-driven with working defaults — a fresh clone needs no `.env`. Copy
`.env.example` → `.env` to override. **`.env` is git-ignored; never commit secrets.**

### Core

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Standard |
| `API_PORT` / `API_HOST_PORT` | `4000` | API listen / published host port |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:3005` | Comma-separated allowed origins (a portal origin missing here breaks the identity banner) |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4001/api` | The API base the portal calls (build-time) |
| `DATABASE_URL` | `postgresql://constellation:constellation@localhost:5432/constellation` | Postgres connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis for the queue |
| `JWT_SECRET` | `change-me-in-production` | **Change in production** |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@constellation.local` / `changeme` | Seeded on first boot with a DB |
| `VIEWER_EMAIL` / `VIEWER_PASSWORD` | `viewer@constellation.local` / `changeme` | Seeded non-admin (for RBAC testing) |
| `PLUGINS_DIR` | `plugins` | Directory scanned for installed plugins |

### Engine

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Local model server |
| `DEFAULT_MODEL` | `llama3.2` | Default model id (set to a model you have, e.g. `qwen2.5-coder:7b`) |
| `MODEL_TIMEOUT_MS` | `60000` | Per model-call timeout (raise to `180000` for large models on CPU) |
| `ENGINE_MAX_STEPS` | `20` | Hard ceiling on agent loop iterations |
| `ENGINE_MAX_TOKENS_PER_TASK` | `100000` | Per-task token budget (dollar-cap seam) |
| `ENGINE_MODEL_RETRIES` | `3` | Bounded retries for transient model failures |
| `ENGINE_REQUIRE_APPROVAL_ALL` | `false` | `true` = supervised mode: **every** tool call needs approval |
| `SCHEDULER_POLL_INTERVAL_MS` | `30000` | Scheduler sweep cadence |
| `ENGINE_WORKER_MODE` | `embedded` | `separate` runs the worker in its own process |
| `OPENROUTER_API_KEY` | *(unset)* | **Opt-in** cloud models (one key → many). Placeholder only in `.env.example` |
| `DEEPSEEK_API_KEY` | *(unset)* | **Opt-in** DeepSeek direct API |

### Observability, SSO, Brain

`OTEL_EXPORTER_OTLP_ENDPOINT` (unset = tracing off), `METRICS_ENABLED`, the `OIDC_*` block (unset
= local JWT only), and the `GRAPHIFY_*` / `BRAIN_*` block are all documented inline in
[`.env.example`](../.env.example). All are optional; unset means the corresponding feature is off
and the platform behaves as if it never existed.

> **Secrets go only in `.env`.** `.env.example` must contain placeholders only. The repo ships
> with zero real keys, and a PII/secret sweep is part of the publish workflow.

---

## 5. Enabling AI models

**Local ($0), the default:** install [Ollama](https://ollama.ai), pull a model, and point the
API at it:

```bash
ollama pull qwen2.5-coder:7b
# in .env:
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_MODEL=qwen2.5-coder:7b
```

**Cloud (opt-in, per task):** set a key in `.env` (never anywhere tracked):

```bash
OPENROUTER_API_KEY=sk-or-...        # one key unlocks GPT-OSS, Qwen, DeepSeek, Claude, …
# then submit a task with a cloud model:
#   POST /api/engine/tasks { "prompt": "...", "model": "openai/gpt-oss-120b" }
```

With no key, cloud providers report `reachable: false` and every task completes on Ollama — the
router falls back automatically. See [ARCHITECTURE.md §9](ARCHITECTURE.md#9-the-model-router).

---

## 6. The Brain (knowledge graph)

Optional, local, $0. Build a Graphify graph over the repo, then point the API at it:

```bash
uv tool install graphifyy        # or: pipx install graphifyy
graphify .                       # writes graphify-out/graph.json
# in .env:
GRAPHIFY_GRAPH_PATH=./graphify-out/graph.json
```

Or run the Graphify sidecar (MCP server) via the `brain` compose profile. `graphify-out/` is
git-ignored — the graph is generated, never committed. Details: [BRAIN.md](BRAIN.md).

---

## 7. Federation & SSO overlay

The federation overlay adds SSO (Keycloak) and the full observability stack (Grafana,
Prometheus, Loki, Tempo) behind a Caddy reverse proxy. It is **heavy (several GB)** and strictly
opt-in behind a compose profile — a plain `docker compose up` never starts it.

```bash
make fed-config     # validate base + federation config
make fed-up         # start everything
make fed-health     # probe each endpoint through the proxy
make fed-down       # stop (volumes preserved)
```

Everything then lives under `http://localhost:8080` (`/` portal, `/api/*` core, `/auth/*`
Keycloak, `/tools/grafana`, `/tools/chat`, `/tools/langflow`).

### Turning on SSO

SSO is **off by default** — local JWT login only. Point the API at an OIDC issuer to enable it:

```bash
OIDC_ISSUER_URL=http://localhost:8081/auth/realms/constellation
OIDC_AUDIENCE=constellation
```

The API then runs two verifiers in order: the platform's own JWT first (fast, offline), then
OIDC. Local logins keep working, so SSO can be switched on or off without locking anyone out.
Only asymmetric algorithms are accepted; `iss`/`aud`/`exp`/`nbf` are all enforced.

> ⚠️ **Dev defaults only.** The overlay runs Keycloak in `start-dev` (in-memory H2 — realm config
> does *not* survive `fed-down`), with no TLS and `changeme` passwords. Set real values and TLS
> before exposing anything beyond localhost.

---

## 8. Database & migrations

Constellation ships a **committed Prisma migration history** (`apps/api/prisma/migrations/`).
Production and CI apply schema changes with `prisma migrate deploy` — **not** `db push`.

```bash
cd apps/api
./node_modules/.bin/prisma migrate status     # inspect drift
./node_modules/.bin/prisma migrate deploy      # apply pending (CI/prod)
./node_modules/.bin/prisma migrate dev --create-only --name <name>   # author a new migration
```

The Docker entrypoint applies migrations automatically before the server starts. Adopting the
history on a pre-existing `db push` database is a one-time, non-destructive
`prisma migrate resolve --applied <migration>` — see [../apps/api/prisma/README.md](../apps/api/prisma/README.md).

> **Never run `prisma db push` against a shared/important database** — it can drop columns. It's
> only for throwaway local dev DBs.

---

## 9. Production deployment

The base `docker-compose.yml` is the deploy foundation — **Coolify consumes it directly**, so
what runs locally is what ships. A staged path (nothing is provisioned until you decide):

```mermaid
flowchart LR
  A["A · Local proof<br/>($0, laptop)"] --> B["B · Prod-like local<br/>(TLS, secrets mgr, backups, chaos)"]
  B --> C["C · Single-node prod<br/>(VPS + Coolify, ~$5–20/mo)"]
  C --> D["D · Reliable prod<br/>(offsite backups, alerts)"]
  D --> E["E · HA<br/>(multi-node, only if usage demands)"]
```

A production checklist:

- [ ] Set a strong `JWT_SECRET`, change all `changeme` passwords, provide a real Postgres/Redis.
- [ ] Put the stack behind TLS (Caddy/Traefik) and enable SSO (`OIDC_*`) with a prod-mode Keycloak.
- [ ] Run the worker as a **separate process** (`ENGINE_WORKER_MODE=separate`) for resilience.
- [ ] Enable metrics + tracing; wire alerts on the Grafana dashboard.
- [ ] Set token/cost budgets; enable `ENGINE_REQUIRE_APPROVAL_ALL` if you want full supervision.
- [ ] Configure scheduled `pg_dump` backups and **rehearse a restore** into a clean environment.
- [ ] Never expose the dev-default federation overlay as-is.

> A single Compose host is **not** high availability. Treat Stage C as "live and monitored,"
> not "highly available." See [SECURITY.md](../SECURITY.md) and
> [ROADMAP.md#known-limitations](ROADMAP.md#known-limitations).

---

## 10. The CLI

The `constellation` CLI (in `packages/cli`) provides operational read commands over the live API
and a plugin scaffolder:

```bash
constellation ops health          # aggregate platform health
constellation ops engine status   # engine, queue, providers, scheduler, supervisor
constellation ops tasks           # recent agent tasks
constellation ops schedules       # cron/event schedules
constellation ops deadletters     # failed/classified tasks
constellation ops plugins         # loaded plugins + state

constellation generate plugin my-plugin   # scaffold a fully-typed plugin
```

---

## 11. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Portal shows a "wrong API" banner | Its API base isn't Constellation (e.g. another process on the port). Set `NEXT_PUBLIC_API_URL` to the real API and ensure its origin is in `CORS_ORIGINS`. |
| `POST /engine/tasks` returns **503** | The engine is disabled because Redis is unreachable — start Redis or fix `REDIS_URL`. This is the honest degrade path, not a crash. |
| Model calls time out on large models | Raise `MODEL_TIMEOUT_MS` (e.g. `180000`) — big models on CPU can exceed the 60s default; the bounded retry absorbs transient timeouts. |
| A plugin shows `state: "failed"` | The `error` field names the exact reason (bad manifest field, version mismatch, import failure, hook throw). Start there. |
| "database layer disabled" in logs | No reachable Postgres — the platform still boots and serves; provide a `DATABASE_URL` to enable persistence. |
| Editing a compose healthcheck had no effect | A running container keeps its old healthcheck — `docker compose up -d --force-recreate <svc>`. |
