#!/usr/bin/env bash
# Engine v0.4 scheduler live-proof boot — API on :4001 against the running local infra.
# Sets the scheduler to poll every 5s so a cron schedule's auto-enqueue is observable fast.
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
cd apps/api
exec node dist/main.js
