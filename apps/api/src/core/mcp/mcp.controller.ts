import { Body, Controller, Header, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { McpService } from "./mcp.service.js";

/**
 * Phase 4.0 — MCP endpoint. JSON-RPC 2.0 request/response over HTTP, guarded
 * by the global JWT guard (an MCP client sends the portal bearer token).
 * Every MCP client exchange starts with `initialize` then `tools/list`, then
 * `tools/call` for the tool of choice — all handled in mcp.service.ts.
 */
@ApiTags("mcp")
@Controller("mcp")
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Post()
  @Header("Content-Type", "application/json")
  @ApiOkResponse({ description: "One JSON-RPC request → one JSON-RPC response (initialize / tools/list / tools/call …)." })
  async handle(@Body() body: unknown) {
    return this.mcp.handle(body);
  }
}
