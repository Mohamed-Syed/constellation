# Live-proof evidence — Phase 4.0 · MCP CLIENT side (4.3 tail) (2026-08-05)

Polaris. Files: `task.json` (steps with the external tool call + result),
`api.log` (McpClientService boot line), `mcp-test-server.log`.

## What shipped
- **`McpClientService`** (core/engine) — the AGENT plane can CALL external MCP
  servers as tools. `MCP_CLIENT_URLS` env: `alias=http://host:port/mcp`
  comma-separated; optional `MCP_CLIENT_HEADERS` JSON. At worker-prompt build
  time each server's `tools/list` is discovered (30s cache) and surfaced as
  `plugin="mcp" tool="<alias>.<name>"`; the worker proxies the agent's args via
  JSON-RPC `tools/call` and returns the content text. Unreachable servers
  degrade to "no tools from this server" — the platform is unaffected.
- Worker integration: system prompt includes the MCP tool lines; executeToolCall
  branches plugin==="mcp" → invokeMcpTool (same ToolResult shape); approval gate
  skips per-tool flags for remote tools. The approve→resume path re-enters the
  worker, so MCP tools work under supervision too. `.env.example` block added.

## LIVE PROOF (real agent → real external MCP server)
- Local MCP test server on :9101 (JSON-RPC: initialize / tools/list / tools/call
  with echo + add).
- api booted with `MCP_CLIENT_URLS=test=http://localhost:9101/mcp` → boot log:
  "MCP client: 1 external server(s) configured (test)".
- An agent task was instructed to call the external tool. Its steps show:
  `tool_call -> {"args":{"message":"hello-from-constellation"},"tool":"test.echo","plugin":"mcp"}`
  `tool_result -> "echoed: hello-from-constellation"`
  — the response came from the EXTERNAL server through the proxy; the task
  **completed** (3 steps, 1108 tokens) with the echo in its summary.
- Honest note: the first probe's call returned "fetch failed" because the test
  server had never started (its log redirect target dir was missing) — the
  wiring was proven on the retry; the failure mode (server down → tool error,
  task still completes) is itself the documented degrade path.

## Gates
api **593** (43 files, +7 mcp-client tests) · full four-gate in the round-close
pass.
