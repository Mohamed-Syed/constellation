import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/engine.module.js";
import { McpController } from "./mcp.controller.js";
import { McpService } from "./mcp.service.js";

/**
 * Phase 4.0 — MCP server module. Reuses the engine services (imported from
 * EngineModule); declares only the JSON-RPC surface.
 */
@Module({
  imports: [EngineModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
