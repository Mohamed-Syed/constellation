#!/usr/bin/env bash
# Boot the Constellation API on host port 4001 against local infra.
# Usage: boot-api.sh <logfile>   (env overrides via the variables below)
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
export API_PORT=4001
export API_GLOBAL_PREFIX=api
export DATABASE_URL="${DATABASE_URL:-postgresql://constellation:constellation@localhost:5432/constellation}"
export JWT_SECRET="$(grep '^JWT_SECRET=' .env | cut -d= -f2-)"
export REDIS_URL="${REDIS_URL:-redis://localhost:6380}"
export DEFAULT_MODEL="${DEFAULT_MODEL:-qwen2.5-coder:1.5b}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
cd apps/api
exec node dist/main.js
