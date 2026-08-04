#!/usr/bin/env bash
# Phase 2.0 2.6 — SSO round-trip boot: api on :4001 WITH the OIDC seam live
# (real Keycloak). Everything from root .env; the JWKS URL is overridden to
# the HOST-visible form because this boot runs OUTSIDE the compose network
# (the .env value "keycloak:8080" only resolves inside the overlay).
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
export API_PORT=4001
export API_GLOBAL_PREFIX=api
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
# OIDC seam: issuer + audience come from root .env; JWKS must be reachable
# from THIS process — localhost:8081 (host port), NOT the compose name.
export OIDC_ISSUER_URL="$(grep '^OIDC_ISSUER_URL=' .env | cut -d= -f2-)"
export OIDC_AUDIENCE="$(grep '^OIDC_AUDIENCE=' .env | cut -d= -f2-)"
export OIDC_JWKS_URI="${OIDC_JWKS_URI_HOST:-http://localhost:8081/auth/realms/constellation/protocol/openid-connect/certs}"
cd apps/api
exec node dist/main.js
