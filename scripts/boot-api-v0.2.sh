#!/usr/bin/env bash
# Engine v0.2 round boot script — API on :4001 against local infra.
# Sets the env needed for THIS round: real Postgres, Redis:6380,
# qwen2.5-coder:7b, and the graphify plugin pointed at the LIVE brain
# sidecar MCP endpoint (:8791) — the real tool target for the round.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
export API_PORT=4001
export API_GLOBAL_PREFIX=api
export DATABASE_URL="postgresql://constellation:constellation@localhost:5432/constellation"
export JWT_SECRET="$(grep '^JWT_SECRET=' .env | cut -d= -f2-)"
export REDIS_URL="${REDIS_URL:-redis://localhost:6380}"
export DEFAULT_MODEL="${DEFAULT_MODEL:-qwen2.5-coder:7b}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
export GRAPHIFY_PLUGIN_MCP_URL="${GRAPHIFY_PLUGIN_MCP_URL:-http://127.0.0.1:8791/mcp}"
export ENGINE_MAX_STEPS="${ENGINE_MAX_STEPS:-20}"
# 7b needs >60s when a large tool result is in context (seen live in Task 1).
export MODEL_TIMEOUT_MS="${MODEL_TIMEOUT_MS:-180000}"
# Supervised mode: ENGINE_REQUIRE_APPROVAL_ALL=true pauses EVERY tool call.
export ENGINE_REQUIRE_APPROVAL_ALL="${ENGINE_REQUIRE_APPROVAL_ALL:-false}"
cd apps/api
exec node dist/main.js
