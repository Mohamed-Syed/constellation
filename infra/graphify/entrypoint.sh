#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Constellation Brain sidecar entrypoint.
#
#   1. build the graph once (blocking) so graph.json exists before we serve;
#   2. `graphify watch /corpus` in the background to keep it fresh;
#   3. `python -m graphify.serve … --transport http` in the FOREGROUND (PID 1
#      semantics: if the MCP server dies the container dies and Docker's
#      restart policy takes over).
#
# Keyless by default: GRAPHIFY_MODE=code-only uses local tree-sitter AST
# extraction, no LLM, no network, $0. Set GRAPHIFY_MODE=docs to also index
# markdown/PDF — that needs a model backend, which we point at a LOCAL Ollama
# (GRAPHIFY_BACKEND=ollama), still $0 and still offline.
# ---------------------------------------------------------------------------
set -euo pipefail

CORPUS="${GRAPHIFY_CORPUS:-/corpus}"
OUT="${CORPUS}/graphify-out"
GRAPH="${OUT}/graph.json"
PORT="${GRAPHIFY_MCP_PORT:-8791}"
MODE="${GRAPHIFY_MODE:-code-only}"
BACKEND="${GRAPHIFY_BACKEND:-ollama}"

# Extraction flags. --no-viz skips graph.html (big + useless headless);
# --no-label skips LLM community naming, which is what makes code-only keyless.
build_flags=(--no-viz)
if [ "${MODE}" = "code-only" ]; then
  build_flags+=(--code-only --no-label)
else
  build_flags+=("--backend=${BACKEND}")
  [ -n "${GRAPHIFY_MODEL:-}" ] && build_flags+=("--model=${GRAPHIFY_MODEL}")
fi

mkdir -p "${OUT}"

echo "[brain] corpus=${CORPUS} mode=${MODE} out=${OUT} mcp-port=${PORT}"
echo "[brain] initial graph build: graphify ${CORPUS} ${build_flags[*]}"

# A failed build must NOT stop us from serving a previously-good graph, and
# must not wedge the container: the rest of the platform has to boot without
# the brain, and the brain has to boot without a perfect corpus.
if ! graphify "${CORPUS}" "${build_flags[@]}"; then
  echo "[brain] WARNING: initial build failed — continuing with any existing graph" >&2
fi

if [ ! -f "${GRAPH}" ]; then
  echo "[brain] no graph.json yet; writing an empty placeholder so MCP can start" >&2
  printf '{"nodes": [], "edges": []}\n' > "${GRAPH}"
fi

# --- keep it fresh -------------------------------------------------------
if [ "${GRAPHIFY_WATCH:-1}" = "1" ]; then
  echo "[brain] starting: graphify watch ${CORPUS}"
  graphify watch "${CORPUS}" &
  WATCH_PID=$!
  trap 'kill "${WATCH_PID}" 2>/dev/null || true' TERM INT EXIT
  # `graphify watch` exits instantly if the `watchdog` package is missing.
  # Fail LOUDLY rather than serving a graph that silently never refreshes.
  sleep 3
  if ! kill -0 "${WATCH_PID}" 2>/dev/null; then
    echo "[brain] ERROR: 'graphify watch' died on startup — the graph will NOT auto-refresh." >&2
    echo "[brain]        (usual cause: the 'watchdog' pip package is missing from the image)" >&2
  else
    echo "[brain] watcher alive (pid ${WATCH_PID})"
  fi
fi

# --- serve MCP (foreground) ---------------------------------------------
serve_flags=(--transport http --host 0.0.0.0 --port "${PORT}" --json-response --stateless)
# Optional shared secret for the HTTP transport; unset = open on the compose
# network only (the port is published to 127.0.0.1 by default in compose).
[ -n "${GRAPHIFY_API_KEY:-}" ] && serve_flags+=(--api-key "${GRAPHIFY_API_KEY}")

echo "[brain] serving MCP: python -m graphify.serve ${GRAPH} ${serve_flags[*]}"
exec python -m graphify.serve "${GRAPH}" "${serve_flags[@]}"
