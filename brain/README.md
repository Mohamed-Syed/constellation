# 🧠 Constellation Brain — the vault

This folder is the platform's **memory**: plain markdown, written by agents and
plugins, read by everyone.

It is one half of the brain (see [`docs/BRAIN.md`](../docs/BRAIN.md)):

```
brain/ (this vault)  ──►  Graphify sidecar  ──►  graphify-out/graph.json
   ▲  remember()                                          │
   │                                                      ▼
 agents & plugins  ◄───────  core/memory  ◄──────  query() / graph() / stats()
```

## How notes get here

`POST /api/brain/remember` (permission `core:brain:write`), or from inside a
plugin:

```ts
await ctx.memory?.remember({
  title: "Loader needs pathToFileURL on Windows",
  body: "String `file://C:/...` imports fail; use pathToFileURL().",
  tags: ["loader", "windows"],
  source: "nova",
});
```

`BrainService.remember()` appends to `brain/notes/YYYY-MM-DD.md` — one file per
day, each entry a `##` heading plus `when` / `source` / `tags` bullets. Appending
to a daily log (rather than a file per note) keeps `graphify watch` from churning
through thousands of tiny files.

You can also just **write markdown here by hand**. Anything in this folder is
corpus; the engine does not care who typed it.

## How notes get read

| Route | Permission | Behaviour with no graph built |
|---|---|---|
| `POST /api/brain/query` | `core:brain:read` | Honest abstain: `grounded: false` + a literal vault text match, clearly labelled |
| `GET /api/brain/graph` | `core:brain:read` | `{ nodes: [], edges: [], meta: { available: false, detail } }` |
| `GET /api/brain/stats` | `core:brain:read` | `available: false`, zero counts, real `vaultNotes` count |
| `POST /api/brain/remember` | `core:brain:write` | Works — the vault needs no engine |

**Nothing here ever throws because the brain is missing.** Same discipline as
`PrismaService`: degrade, log once, stay up.

## Building the graph (optional, $0/local)

```bash
uv tool install graphifyy      # or: pipx install graphifyy
graphify .                     # writes graphify-out/{graph.json,graph.html,GRAPH_REPORT.md}
graphify watch .               # live rebuilds (AST parsing needs no LLM, no keys)
```

Code is parsed locally and deterministically. Only doc/PDF summarisation wants a
model backend — use `--backend ollama` to stay fully offline and free.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `GRAPHIFY_MCP_URL` | _(unset)_ | MCP sidecar endpoint. Set → preferred transport |
| `GRAPHIFY_GRAPH_PATH` | `<repo>/graphify-out/graph.json` | Local graph to read |
| `GRAPHIFY_BIN` | `graphify` | CLI used for the local `query` fallback |
| `GRAPHIFY_TIMEOUT_MS` | `30000` | Timeout for MCP + CLI calls |
| `BRAIN_VAULT_DIR` | `<repo>/brain` | This folder |
| `BRAIN_REPO_ROOT` | auto-detected | Repo root (found by walking up to `pnpm-workspace.yaml`) |

## Conventions for good memories

- **One fact per note.** A note that says three things is hard to link.
- **Title it like a claim**, not a topic: "Turbo cache reports false greens",
  not "turbo notes".
- **Tag with the subsystem** (`loader`, `rbac`, `portal`, `infra`).
- **Say where it came from** — `source` is provenance, and provenance is the
  whole point of a graph-backed brain.
- **Don't put secrets in here.** The vault is committed markdown.

---

_Seeded by Nova (SDK & core-plugins lane) with the `core/memory` subsystem._
