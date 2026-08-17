# ---------------------------------------------------------------------------
# Constellation — the Brain sidecar (Graphify knowledge graph over MCP).
#
# Deliberately a plain Python image with `pip install graphifyy[mcp]`:
#   * the base `graphifyy` package ships the CLI + AST extractors only;
#   * the HTTP/Streamable MCP transport needs the `[mcp]` extra
#     (mcp + starlette + uvicorn) — WITHOUT it `python -m graphify.serve
#     --transport http` dies with "HTTP transport needs the mcp extra".
#     Verified the hard way 2026-08-02; do not drop the extra.
#
# No API keys, no network at runtime: code is parsed locally with tree-sitter.
# Docs/PDF extraction is opt-in and points at a local Ollama ($0) — see
# GRAPHIFY_DOCS_BACKEND in the entrypoint.
# ---------------------------------------------------------------------------
FROM python:3.12-slim

# git: `graphify clone` and repo-aware extraction shell out to it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ARG GRAPHIFY_VERSION=
# `watchdog` is NOT a dependency of graphifyy or its [mcp] extra, but
# `graphify watch` exits immediately with "error: watchdog not installed"
# without it. Verified 2026-08-02 — the sidecar looked healthy while the
# graph silently never refreshed. Keep it pinned in here.
# RAG round (2026-08-05): the `[ollama]` extra adds the `openai` client the
# docs backend needs — WITHOUT it every semantic chunk fails with "the
# 'openai' package is required for this backend". Verified the hard way.
RUN pip install --no-cache-dir "graphifyy[mcp,ollama]${GRAPHIFY_VERSION:+==${GRAPHIFY_VERSION}}" watchdog

# The corpus is mounted read-only per-subfolder; only graphify-out is writable
# (graphify always writes <corpus>/graphify-out, so that path is a volume).
WORKDIR /corpus

COPY infra/graphify/entrypoint.sh /usr/local/bin/brain-entrypoint.sh
RUN chmod +x /usr/local/bin/brain-entrypoint.sh

EXPOSE 8791
ENTRYPOINT ["/usr/local/bin/brain-entrypoint.sh"]
