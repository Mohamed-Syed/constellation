# MCP — Model Context Protocol

> Constellation is an MCP **server** and an MCP **client** — the universal agent hub: external agents can drive Constellation, and Constellation's agents can use external MCP tools.

## As an MCP server

`POST /api/mcp` speaks JSON-RPC (JWT-guarded) with the standard MCP methods:

| Method | Purpose |
|---|---|
| `initialize` | Handshake (protocol version, capabilities) |
| `tools/list` | The exposed Constellation tools |
| `tools/call` | Invoke one |
| `ping` / `resources` | Liveness / resource listing |

Exposed tools include engine operations (`list_tasks`, `run_task`, `engine_health`, `list_schedules`) and **`delegate_task`** — an external MCP client can spawn a crew and wait for it (see **Crews & delegation**).

> **Example:** a Claude/other-agent session connects to `http://localhost:4001/api/mcp` with the platform JWT, lists tools, calls `run_task`, and receives the completed task's result — a real task executed on DeepSeek.

## As an MCP client

Configure external servers with `MCP_CLIENT_URLS` (alias=url list) and optional `MCP_CLIENT_HEADERS`:

```
MCP_CLIENT_URLS=my-tools=http://localhost:9101/mcp
```

1. At prompt-build time the platform discovers the server's tools (`tools/list`, cached 30s) and surfaces them to the agent as `plugin="mcp" tool="alias.name"`.
2. The worker proxies calls through `tools/call` with your arguments.
3. An unreachable server degrades to **no tools** — it never breaks the agent run.

> **Example proven live:** an agent called `test.echo` on an external MCP server and the echoed result completed its task.

## Permissions

- The MCP server is **JWT-guarded** (same tokens as the API).
- External tool calls flow through the same approval gate if the tool is flagged.
