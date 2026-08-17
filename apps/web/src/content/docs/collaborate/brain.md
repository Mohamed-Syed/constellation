# Brain — the knowledge graph

> The Brain is the platform's persistent memory: a Graphify knowledge graph over your documentation and notes, with grounded Q&A, semantic search, and the ability to remember new knowledge.

## What the Brain knows

- **Docs mode (default)**: the graph is built from your markdown documentation (via local Ollama embeddings) — nodes for documents and concepts, edges for relationships.
- **Notes**: anything you *remember* is appended to the vault and indexed.
- Typical materialized graph: thousands of nodes / edges (e.g. 2,274 nodes / 4,269 edges on the reference install).

## Using the Brain page (`/brain`)

| Action | How |
|---|---|
| **Query** | Ask a question — the answer is **grounded**: it cites the graph nodes it came from, with provenance |
| **Remember** | Add a note — it is stored in the vault (`brain/notes/`) and appears in the graph |
| **Browse** | The graph view (adaptive layout; hub labels appear on zoom) |
| **Stats** | Nodes / edges / last build; `available: false` is reported honestly when the sidecar is down |

## Semantic search

`POST /api/brain/search` embeds your query (Ollama `nomic-embed-text`, batched) and returns the top relevant notes/labels by cosine rank — the remember → index → retrieve loop is closed: a remembered note becomes the top hit for a related query.

## API

| Endpoint | Purpose | Permission |
|---|---|---|
| `POST /api/brain/query` | Grounded Q&A | `core:brain:read` |
| `POST /api/brain/remember` | Append a note | `core:brain:write` |
| `POST /api/brain/search` | Semantic retrieval | `core:brain:read` |
| `GET /api/brain/stats` | Graph stats | `core:brain:read` |
| `GET /api/brain/graph` | The graph JSON | `core:brain:read` |

## Requirements & honest degradation

- Local Ollama must be running for **embeddings** (docs indexing + search). On the reference host Ollama is stopped by default; the Brain then reports `available: false` / degraded honestly until it is restarted.
- Graphify runs as a sidecar (MCP at `http://127.0.0.1:8791/mcp`, container `constellation-graphify`).
- `GRAPHIFY_MODE=docs` is the default; the graph is bind-mounted so the API reads what the sidecar builds.
