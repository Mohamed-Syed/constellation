# Live-proof evidence — Phase 4.0 · SEMANTIC RETRIEVAL LAYER (4.2 tail) (2026-08-05)

Polaris. Files: `search1.json` (model-routing query), `search2.json`
(delegation query).

## What shipped
- **`BrainService.search`** — the pgvector/Chroma alternative with ZERO new
  infra: the query AND the index (vault notes split into `##` sections + all
  knowledge-graph node labels) are embedded by the local Ollama
  `nomic-embed-text` (`/api/embed`, batched 64, 30s timeout), ranked by cosine
  similarity (pure exported `cosineSimilarity`), thresholded at 0.16, top-8.
  The index is built lazily once and cached 5 minutes; without Ollama it
  degrades honestly to `unavailable: true`.
- **REST** `POST /api/brain/search {question}` → `{items: [{id, label, score}],
  unavailable}` (BRAIN_READ).
- `.env`: `BRAIN_EMBED_MODEL` (default nomic-embed-text).

## LIVE PROOF (real embeddings via Ollama)
- `search("how does the engine route between models?")` → 8 hits; top:
  **EngineModule 0.692**, engine() 0.673, engine.ts, EngineStepType — all
  semantically on-topic.
- `search("delegation and sub-agent crews")` → top hit: **"Crews 4.1 record"
  0.667 — the vault note written by `POST /api/brain/remember` in the crews
  round** — then ENGINE_AGENT_PERMISSIONS, AgentAction, agent-worker.service.
  **The full persistent-memory loop is closed: remember → vault note →
  embedding index → semantic retrieval finds it.**
- First index build takes ~48s (2274 node labels embedded in ~36 Ollama
  batches on CPU); subsequent searches hit the 5-min cache and return
  instantly.

## Gates
api **596** (43 files, +3 search tests) · full four-gate in the round-close
pass.
