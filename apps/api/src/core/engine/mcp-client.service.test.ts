import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpClientService } from "./mcp-client.service.js";

function rpcResponse(method: string, result: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: 1, result };
}

describe("McpClientService — MCP client side (4.3 tail)", () => {
  const realEnv = { urls: process.env.MCP_CLIENT_URLS, headers: process.env.MCP_CLIENT_HEADERS };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (_url: string, init: { body?: string }) => {
      const method = (JSON.parse(init.body ?? "{}") as { method: string }).method;
      if (method === "initialize") {
        return { ok: true, json: async () => rpcResponse("initialize", { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "test-server", version: "1.0" } }) };
      }
      if (method === "tools/list") {
        return {
          ok: true,
          json: async () =>
            rpcResponse("tools/list", {
              tools: [
                { name: "echo", description: "Echo a message", inputSchema: { type: "object", properties: { message: { type: "string" } } } },
                { name: "add", description: "Add two numbers", inputSchema: { type: "object" } },
              ],
            }),
        };
      }
      if (method === "tools/call") {
        const params = (JSON.parse(init.body ?? "{}") as { params: { name: string; arguments: { message?: string } } }).params;
        if (params.name === "echo") {
          return { ok: true, json: async () => rpcResponse("tools/call", { content: [{ type: "text", text: `echo: ${params.arguments.message ?? ""}` }] }) };
        }
        if (params.name === "boom") {
          return { ok: true, json: async () => rpcResponse("tools/call", { isError: true, content: [{ type: "text", text: "it broke" }] }) };
        }
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.MCP_CLIENT_URLS = "test=http://localhost:9101/mcp";
    process.env.MCP_CLIENT_HEADERS = '{"Authorization":"Bearer x"}';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (realEnv.urls === undefined) delete process.env.MCP_CLIENT_URLS;
    else process.env.MCP_CLIENT_URLS = realEnv.urls;
    if (realEnv.headers === undefined) delete process.env.MCP_CLIENT_HEADERS;
    else process.env.MCP_CLIENT_HEADERS = realEnv.headers;
  });

  it("discovers tools from the configured server (initialize + tools/list)", async () => {
    const svc = new McpClientService();
    const tools = await svc.tools();
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ server: "test", name: "echo", description: "Echo a message" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // initialize + tools/list
  });

  it("caches the discovery for 30s", async () => {
    const svc = new McpClientService();
    await svc.tools();
    await svc.tools();
    expect(fetchMock.mock.calls.filter((c) => (JSON.parse(c[1]?.body ?? "{}") as { method: string }).method === "tools/list")).toHaveLength(1);
  });

  it("promptLines renders plugin=mcp tool=alias.name lines", async () => {
    const svc = new McpClientService();
    const lines = await svc.promptLines();
    expect(lines[0]).toContain('plugin="mcp" tool="test.echo"');
  });

  it("call proxies to tools/call and extracts the text content", async () => {
    const svc = new McpClientService();
    const res = await svc.call("test.echo", { message: "hi" });
    expect(res.ok).toBe(true);
    expect(res.result).toBe("echo: hi");
  });

  it("call surfaces isError results as failures", async () => {
    const svc = new McpClientService();
    const res = await svc.call("test.boom", {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe("it broke");
  });

  it("call rejects unknown aliases", async () => {
    const svc = new McpClientService();
    const res = await svc.call("nope.echo", {});
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Unknown MCP server alias");
  });

  it("degrades to no tools when MCP_CLIENT_URLS is unset", async () => {
    delete process.env.MCP_CLIENT_URLS;
    const svc = new McpClientService();
    expect(await svc.tools()).toEqual([]);
    expect(await svc.promptLines()).toEqual([]);
  });
});
