# Deployment

> How to run Constellation: the local stack, the Docker services, ports, the federation overlay, and production notes.

## Prerequisites

- Node.js 22+, pnpm, Docker + Docker Compose
- Postgres + Redis (or the Docker containers below)

## The local stack (reference setup)

| Component | Port | How to start |
|---|---|---|
| Postgres | 5432 | `docker compose up -d postgres` |
| Redis | 6380 | `docker compose up -d redis` (note the non-default port) |
| Graphify (Brain sidecar) | 8791 (MCP) | `docker compose up -d graphify` |
| Prometheus / Grafana | — | `docker compose up -d` |
| **API** | **4001** | `bash scripts/boot-api-v0.3.sh` (from the repo root; sources `.env`) |
| **Portal** | **3005** | `cd apps/web && npx next start -p 3005` (production build) |
| Edge peer (optional mesh sim) | 4002 | second API instance (see scripts/live-mesh-proof.sh) |

> **IMPORTANT:** the API runs `node dist/main.js` — after any source change, rebuild first (`turbo run build` or `pnpm --filter @constellation/api build`) or the running API serves stale code.

## The production build (standing demo mode)

```
./node_modules/.bin/turbo run lint build typecheck test --force --concurrency=1   # build everything fresh
```

Then start API + portal as above. The portal must run as `next start` (production) — the dev server is hydration-flaky.

## The gate

```
./node_modules/.bin/turbo run lint build typecheck test --force --concurrency=1
# 20/20 tasks green · 813 tests (api 689, sdk 21, graphify 40, browser-use 47, cli 16)
```

## The federation overlay (SSO + federated tools)

```
docker compose -f docker-compose.yml -f docker-compose.federation.yml --profile federation up -d
```

Brings up Keycloak, Caddy (reverse proxy), and the federated tool stack. See **Federated tools & SSO**.

## Tracing (OTel + Tempo)

```
docker compose -f docker-compose.yml -f docker-compose.federation.yml --profile federation up -d tempo
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # set to enable tracing (unset = no-op spans)
```

## Database & migrations

- Committed migration history under `apps/api/prisma/migrations`.
- The entrypoint auto-runs `prisma migrate deploy` on fresh installs.
- **Never run `prisma migrate reset`** — for drift, use `migrate resolve --applied` (proven end-to-end).

## Known environment notes

- Port `4000` is squatted by another product on the reference host — the API always runs on `4001`.
- Redis is on `6380` via `REDIS_HOST_PORT` — not 6379.
- Ollama is stopped by default (operator decision): DeepSeek is the default model; local embeddings (Brain search) degrade honestly until Ollama is restarted.
- Kill a stale port listener:
  `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4001,3005 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`

## Production (roadmap)

- VPS deployment via Coolify is the planned path (blocked on provider + budget decision).
- Enterprise hardening (append-only audit hash chain, secrets manager + rotation, CSRF for cookie mutations, dependency/SBOM scanning) is the documented Phase 6.0 roadmap.
