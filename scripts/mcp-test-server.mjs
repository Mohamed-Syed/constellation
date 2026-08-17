#!/usr/bin/env node
// Tiny local MCP test server for the MCP-CLIENT live proof.
// JSON-RPC over HTTP on :9101 — initialize / tools/list / tools/call (echo, add).
import http from "node:http";

const tools = [
  { name: "echo", description: "Echo a message back", inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } },
  { name: "add", description: "Add two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const { id, method, params } = parsed;
    let result;
    if (method === "initialize") {
      result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "mcp-test-server", version: "1.0.0" } };
    } else if (method === "tools/list") {
      result = { tools };
    } else if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name === "echo") {
        result = { content: [{ type: "text", text: `echoed: ${String(args.message ?? "")}` }] };
      } else if (name === "add") {
        result = { content: [{ type: "text", text: `sum: ${Number(args.a ?? 0) + Number(args.b ?? 0)}` }] };
      } else {
        result = { isError: true, content: [{ type: "text", text: `unknown tool ${name}` }] };
      }
    } else {
      result = {};
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }));
  });
});

server.listen(9101, () => console.log("mcp-test-server listening on :9101"));
