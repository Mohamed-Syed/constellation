# Configuration reference

> Every environment variable the platform honors, with its default and purpose. Secrets live in the git-ignored `.env` file only; `.env.example` documents every key with placeholders.

## Core

| Variable | Default | Purpose |
|---|---|---|
| `API_PORT` | `4001` | API port (4000 is historically squatted on the reference host) |
| `API_GLOBAL_PREFIX` | `api` | Route prefix (`/api/*`) |
| `DATABASE_URL` | `postgresql://constellation:***@localhost:5432/constellation` | Postgres connection |
| `REDIS_URL` | `redis://localhost:6380` | Redis connection (note: **6380**, not 6379) |
| `JWT_SECRET` | — | Signs local JWTs |
| `CORS_ORIGINS` | `http://localhost:3005,http://127.0.0.1:3005` | Allowed portal origins (both spellings — they are different origins to browsers) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@constellation.local` / `changeme` | Seed admin |
| `VIEWER_EMAIL` / `VIEWER_PASSWORD` | `viewer@constellation.local` / `changeme` | Seed viewer |

## Engine

| Variable | Default | Purpose |
|---|---|---|
| `DEFAULT_MODEL` | `deepseek-v4-flash` | Router default + failure fallback model |
| `DEEPSEEK_API_KEY` | *(unset)* | Direct DeepSeek API |
| `DEEPSEEK_DEFAULT_MODEL` | `deepseek-v4-flash` | DeepSeek provider model |
| `DEEPSEEK_THINKING` | — | Thinking-mode toggle |
| `OPENROUTER_API_KEY` | *(unset)* | OpenRouter (one key, many models) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Local Ollama (stopped by default on the reference host) |
| `ENGINE_MAX_STEPS` | `20` | Default ReAct step ceiling |
| `ENGINE_MAX_TOKENS_PER_TASK` | — | Per-task token budget |
| `ENGINE_MODEL_RETRIES` | `3` | Transient-error retries |
| `MODEL_TIMEOUT_MS` | `180000` | Per-model-call timeout |
| `ENGINE_REQUIRE_APPROVAL_ALL` | `false` | Force approval on every tool call |
| `ENGINE_AGENT_PERMISSIONS` | — | Agent-side permission seam |
| `ENGINE_WORKER_MODE` | `embedded` | `separate` runs the worker as its own process |
| `SCHEDULER_POLL_INTERVAL_MS` | `30000` | Scheduler sweep cadence |
| `SUPERVISOR_POLL_INTERVAL_MS` | `30000` | Supervisor sweep cadence |
| `SUPERVISOR_STALE_THRESHOLD_MS` | `300000` | Stale-task threshold |

## Mesh

| Variable | Default | Purpose |
|---|---|---|
| `MESH_PROBE_INTERVAL_MS` | `60000` | Peer health-probe cadence |
| `MESH_PROBE_TIMEOUT_MS` | `5000` | Per-peer probe timeout |
| `MESH_ROUTE_API_KEY` | *(unset)* | Enables cross-instance task routing |

## AI Controller (Phase 5.0)

| Variable | Default | Purpose |
|---|---|---|
| `CONTROLLER_WATCH_ENABLED` | `on` | Autonomous watch loop (off = manual only) |
| `CONTROLLER_WATCH_INTERVAL_MS` | `30000` | Watch tick cadence (min 5000) |

## Plugins & integration

| Variable | Default | Purpose |
|---|---|---|
| `PLUGIN_SANDBOX_MODE` | `off` | `process` = sandboxed plugin execution |
| `PLUGIN_SANDBOX_PLUGINS` | — | Which plugins run sandboxed |
| `GRAPHIFY_PLUGIN_MCP_URL` | `http://127.0.0.1:8791/mcp` | Brain sidecar |
| `GRAPHIFY_MODE` | `docs` | Brain indexing mode |
| `MCP_CLIENT_URLS` | *(unset)* | External MCP servers (`alias=url,…`) |
| `MCP_CLIENT_HEADERS` | *(unset)* | Headers for external MCP calls |
| `ALERT_WEBHOOK_SECRET` | *(unset = dev-accept)* | Alertmanager webhook secret |
| `REPORT_DIR` | `artifacts/reports` | PDF report output |

## Observability

| Variable | Default | Purpose |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(unset)* | Enables OpenTelemetry tracing (unset = spans are no-ops) |
| `OTEL_SERVICE_NAME` | — | Tracer service name |
| `METRICS_ENABLED` | `true` | Prometheus `/api/metrics` |

## SSO / OIDC

| Variable | Default | Purpose |
|---|---|---|
| `OIDC_ISSUER_URL` | *(unset)* | Enables OIDC/Keycloak verification (RS256) |
| `OIDC_*` (client id/secret/audience) | — | OIDC client details |
