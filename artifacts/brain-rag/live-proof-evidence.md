# Live-proof evidence — Phase 4.0 · BRAIN-PAGE UX + DOCS-MODE (RAG) (2026-08-05)

Polaris. Two coupled rounds — the brain-page fixes needed a real graph to verify
against, and the graph needed the docs-mode build to exist.

## Brain-page UX fixes (committed with this round)
- `force-layout.ts`: ADAPTIVE iteration count (150/220/300 by node count) — the
  O(n²) repulsion pass at the 300-node cap no longer blocks the main thread on
  every layout.
- `brain-graph-view.tsx`: layout recomputed on a CONTENT key (not the polled
  graph object identity — this was the 1200+-node jank: the physics re-ran on
  every poll tick); LABEL ANTI-COLLISION + zoom gating (selected/highlighted
  labels always win; hub labels render only ≥0.9 zoom and yield within 46px of
  a placed label); DEGRADED banner when the 300-node cap truncates the corpus.
- Verified in a real browser: /brain renders (NODES/EDGES/VAULT NOTES/LAST
  BUILT stats + NOT BUILT badge + the engine's unavailable detail). Full-graph
  visual verification is staged behind the docs build below.

## Docs-mode (RAG) — graphify sidecar
- `docker-compose.yml`: GRAPHIFY_MODE default `code-only` → **docs** (markdown
  via local Ollama embeddings); graphify-out now BOUND to ./graphify-out so the
  HOST-run api's core/memory finally sees the built graph (the named volume
  silently hid it — the "not built" root cause); GRAPHIFY_MODEL 7b; OLLAMA_API_KEY
  placeholder (the CLI demands it even for local Ollama).
- `infra/graphify/Dockerfile`: `graphifyy[mcp]` → `graphifyy[mcp,ollama]` — the
  docs backend needs the `openai` client; without it every semantic chunk fails
  ("the 'openai' package is required for this backend"). Verified the hard way.
- nomic-embed-text pulled on the host Ollama for the embedding pass.
- Live build (real extraction logs): 258 code files AST-extracted + 11 docs
  detected; with 1.5b every docs chunk bisected into "hollow response" failures
  (model can't emit graph JSON); switched to qwen2.5-coder:7b (already warm) —
  final graph.json materialization + stats/query/remember round-trip verified
  in the round-close pass (see `graph.json` + brain stats in this folder).

## Gates
web typecheck + lint clean (17 pre-existing warnings) · api suite unchanged in
the close pass · full four-gate 20/20 on the final committed tree.
