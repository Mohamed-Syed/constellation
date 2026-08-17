#!/usr/bin/env bash
# Phase 2.0 2.8 — DEDICATED WORKER boot (separate process).
# Runs ONLY the engine loops (AgentWorker + SchedulerEngine + Supervisor)
# against the same Redis queue + Postgres the api uses. The api process must
# be booted with ENGINE_WORKER_MODE=separate so it does NOT run the loops.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
export ENGINE_WORKER_MODE=separate
export ENGINE_IS_WORKER=true
export DATABASE_URL="${DATABASE_URL:-postgresql://constellation:constellation@localhost:5432/constellation}"
export JWT_SECRET="$(grep '^JWT_SECRET=' .env | cut -d= -f2-)"
export REDIS_URL="${REDIS_URL:-redis://localhost:6380}"
export DEFAULT_MODEL="${DEFAULT_MODEL:-qwen2.5-coder:7b}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
export GRAPHIFY_PLUGIN_MCP_URL="${GRAPHIFY_PLUGIN_MCP_URL:-http://127.0.0.1:8791/mcp}"
export MODEL_TIMEOUT_MS="${MODEL_TIMEOUT_MS:-180000}"
if grep -q '^OPENROUTER_API_KEY=.' .env; then
  export OPENROUTER_API_KEY="$(grep '^OPENROUTER_API_KEY=' .env | cut -d= -f2-)"
fi
if grep -q '^DEEPSEEK_API_KEY=.' .env; then
  export DEEPSEEK_API_KEY="$(grep '^DEEPSEEK_API_KEY=' .env | cut -d= -f2-)"
fi
# Sandbox env (Phase 2.0 2.7) — the worker dispatches plugin tools too.
for VAR in PLUGIN_SANDBOX_MODE PLUGIN_SANDBOX_PLUGINS PLUGIN_SANDBOX_TIMEOUT_MS PLUGIN_SANDBOX_MEMORY_MB PLUGIN_SANDBOX_MAX_RESULT_BYTES; do
  if grep -q "^$VAR=." .env; then
    export "$VAR"="$(grep "^$VAR=" .env | cut -d= -f2-)"
  fi
done
cd apps/api
exec node dist/worker-main.js
