#!/usr/bin/env bash
# Engine v0.5 supervisor live-proof boot — API on :4001 against the running infra.
# Sets the supervisor + scheduler to poll fast (5s) so stale-task detection and
# auto-enqueue are observable quickly.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
export API_PORT=4001
export API_GLOBAL_PREFIX=api
export DATABASE_URL="postgresql://constellation:constellation@localhost:5432/constellation"
export JWT_SECRET="$(grep '^JWT_SECRET=' .env | cut -d= -f2- )"
export REDIS_URL="redis://localhost:6380"
export DEFAULT_MODEL="qwen2.5-coder:7b"
export OLLAMA_BASE_URL="http://localhost:11434"
export GRAPHIFY_PLUGIN_MCP_URL="http://127.0.0.1:8791/mcp"
export MODEL_TIMEOUT_MS="180000"
export ENGINE_REQUIRE_APPROVAL_ALL="false"
export SCHEDULER_POLL_INTERVAL_MS="5000"
# Supervisor: poll every 5s, treat a running task with no progress for 25s as stale.
export ENGINE_SUPERVISOR_INTERVAL_MS="5000"
export ENGINE_STALE_TASK_MS="25000"
cd apps/api
exec node dist/main.js
