# Constellation

> **Enterprise plugin platform framework.** A small, secure core provides auth,
> RBAC, navigation, settings, and a plugin loader. Everything else — every
> imported GitHub repository — is an installable **module**. Drop it in, the core
> discovers it. No core rewrites, ever.
>
> _Codename `constellation` (placeholder — rename freely). Separate from the
> Looper project._

## Author's note

**Constellation was built with AI assistance** — a small team of AI coding agents
(an orchestrator plus focused implementers) drove the architecture, the engine,
and the platform hardening under a human product owner. The owner's day job is
**network engineering**, and this project exists to adapt modern agentic + plugin
platform technology (NestJS, BullMQ, Prisma, Graphify, OpenRouter, …) into a
shaped, self-hosted, $0-by-default foundation for the kind of unattended,
24/7 automation systems that traditionally live on data-center hardware. The
code is real, tested (519 unit tests), and live-proven locally — nothing here is
scaffolding. The docs in `docs/` tell the honest story of every round, including
what is and isn't verified.

## Why this exists

Instead of one monolith, Constellation is two cooperating planes:

- **Portal plane** — one SSO login, one navigation, one look. Heavyweight tools
  (Grafana, Langflow, Open WebUI, Coolify, …) are federated as modules behind a
  reverse proxy + shared identity, not rewritten.
- **Agent plane** — the 24/7 automation brain. Capabilities (browser automation,
  code agents, knowledge graph, review) are called as tools.

Both are extended the same way: **plugins that conform to `@constellation/plugin-sdk`**.

## Monorepo layout

```
constellation/
├── apps/
│   ├── api/            # NestJS core: bootstrap, config, plugin loader, health
│   └── web/            # Next.js portal (single pane of glass)
├── packages/
│   └── plugin-sdk/     # THE contract: manifest schema, Plugin interface, context, permissions
├── plugins/
│   └── hello-world/    # reference plugin
└── docs/
    └── MASTER_PLAN.md  # single source of truth — read this to resume
```

## Quick start (local, $0)

```bash
corepack enable
pnpm install
pnpm build                 # builds the SDK + plugins
pnpm --filter @constellation/api dev     # core API → http://localhost:4000/api
pnpm --filter @constellation/web dev     # portal   → http://localhost:3000
```

Health: `GET http://localhost:4000/api/health` · OpenAPI: `/api/docs` ·
Modules: `GET /api/plugins`.

## Run with Docker (full stack, local, $0)

The Compose stack is the closest thing to production: a **real PostgreSQL 16 and
Redis 7**, the NestJS core, and the Next.js portal, on one network. It's also
the deploy foundation for the 24/7 host — Coolify consumes this Compose file
directly, so what runs locally is what ships.

```bash
docker compose up -d --build      # or: make up
curl http://localhost:4000/api/health
docker compose down               # or: make down  (volumes are preserved)
```

| Service | URL | Notes |
|---|---|---|
| Portal (Next.js) | http://localhost:3000 | |
| Core API (NestJS) | http://localhost:4000/api | health at `/api/health`, OpenAPI at `/api/docs` |
| PostgreSQL 16 | `localhost:5432` | db/user/pass `constellation`; named volume `postgres-data` |
| Redis 7 | `localhost:6379` | named volume `redis-data` |

Compose starts them in dependency order and waits on real healthchecks: the API
only boots once Postgres and Redis report healthy.

### Configuration

Everything is `.env`-driven with working defaults, so a fresh clone needs no
`.env` at all. To override, `cp .env.example .env` and edit — `.env` is
git-ignored; never commit secrets.

Host ports are overridable too, which matters when something already owns a
port (a stray gateway on 4000 is a known local hazard):

```bash
API_HOST_PORT=4010 WEB_HOST_PORT=3010 \
  NEXT_PUBLIC_API_URL=http://localhost:4010/api \
  CORS_ORIGINS=http://localhost:3010 \
  docker compose up -d
```

`NEXT_PUBLIC_API_URL` is inlined into the client bundle at **build** time (a
Next.js constraint), so changing it requires `--build`, not just a restart.

### Database schema

The API entrypoint syncs the schema before the server starts. There's no
committed `prisma/migrations` history yet, so it currently runs `prisma db
push` (which creates the `core` schema and its tables); it switches to
`prisma migrate deploy` automatically the moment a migrations directory
exists. To re-sync a running stack: `make migrate`.

### Make targets

```
make up        # build + start everything, print the URLs
make down      # stop (volumes preserved)
make clean     # stop + DELETE the postgres/redis volumes
make logs      # tail all services
make ps        # container status + health
make migrate   # apply the Prisma schema to the running database
make health    # curl the core health endpoint
make psql      # psql shell on the platform database
```

Both images build from the **monorepo root** context (workspace packages plus
the pnpm lockfile live there) and both run as the **non-root** `node` user.

## Portal federation & SSO (P3, opt-in)

The platform **federates** heavyweight tools instead of reimplementing them
(decisions C5/C7): Grafana, Prometheus, Loki, Open WebUI, Langflow and
Keycloak run as their own containers behind one reverse proxy, so the portal
shows them as tiles on a single origin with a single session.

Two pieces make this work, and both are **data, not code**:

- **`config/modules.yaml`** — the federated module registry. Each entry
  becomes a portal tile and a proxy route. Adding a tool means adding an
  entry here; the core is never rewritten. Served at
  `GET /api/federation/modules` (authenticated).
- **`infra/caddy/Caddyfile`** — the reverse proxy that puts `/api`, `/auth`,
  `/tools/*` and the portal on one origin.

### Running it

The federated stack is **heavy** (several GB of RAM, slow first pull), so it
is opt-in behind both a separate compose file *and* a compose profile — a
plain `docker compose up` never starts it:

```bash
make fed-config     # validate base + federation config
make fed-up         # start everything
make fed-health     # probe each endpoint through the proxy
make fed-down       # stop (volumes preserved)
make fed-clean      # stop + delete federation volumes
```

Everything then lives under `http://localhost:8080`:

| Path              | Service                        |
|-------------------|--------------------------------|
| `/`               | Next.js portal                 |
| `/api/*`          | NestJS core API                |
| `/auth/*`         | Keycloak (SSO)                 |
| `/tools/grafana`  | Grafana dashboards             |
| `/tools/chat`     | Open WebUI                     |
| `/tools/langflow` | Langflow flow builder          |

> ⚠️ **Dev defaults only.** Keycloak runs in `start-dev` with an in-memory
> database (realm config does *not* survive `fed-down`), there is no TLS, and
> every admin password defaults to `changeme`. Set real values in `.env`
> before exposing this to anything but localhost.

### Enabling SSO

Single sign-on is **off by default** and the platform behaves exactly as it
did before P3 — local JWT login only. Point the API at an OIDC issuer to
switch it on:

```bash
OIDC_ISSUER_URL=http://localhost:8081/auth/realms/constellation
OIDC_AUDIENCE=constellation
```

The API then runs two token verifiers in order: the platform's own JWT first
(fast, offline, no IdP dependency), then OIDC. Local logins keep working
throughout, so SSO can be switched on — or back off — without locking anyone
out. Only asymmetric algorithms are accepted, and `iss`/`aud`/`exp`/`nbf` are
all enforced; see `apps/api/src/core/auth/oidc-jwt-verifier.service.ts`.

## Tech

TypeScript · NestJS · Next.js (App Router) · TailwindCSS · Zod · pnpm + Turborepo.
PostgreSQL / Redis / OpenSearch / RabbitMQ and SSO arrive in later phases (see the plan).

See [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) for architecture, decisions, roadmap, and the active task split.
