import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { PluginRegistryService } from "./plugin-registry.service.js";

/**
 * Read-only view of the plugin registry. Mutating operations (enable/disable/
 * install/uninstall) arrive with the admin + RBAC layer.
 */
@ApiTags("plugins")
@Controller("plugins")
export class PluginsController {
  constructor(private readonly registry: PluginRegistryService) {}

  @Get()
  @ApiOkResponse({ description: "List every loaded plugin with its state." })
  list() {
    return this.registry.all().map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      state: p.state,
      permissions: p.manifest.permissions,
      navigation: p.manifest.navigation,
      error: p.error,
      health: p.health ?? null,
      healthCheckedAt: p.healthCheckedAt ?? null,
      /** Agent-plane tool count; the full declarations live on the detail route. */
      toolCount: p.manifest.tools.length,
    }));
  }

  @Get(":id")
  @ApiOkResponse({ description: "Full manifest + state for one plugin." })
  get(@Param("id") id: string) {
    const p = this.registry.get(id);
    if (!p) throw new NotFoundException(`No plugin "${id}"`);
    return {
      ...p.manifest,
      state: p.state,
      error: p.error,
      health: p.health ?? null,
      healthCheckedAt: p.healthCheckedAt ?? null,
      /**
       * Declared agent-plane tools, spread explicitly (not just via
       * `...p.manifest`) so this stays a deliberate, documented part of the
       * read API rather than an accident of manifest shape. Read-only:
       * invoking a tool is a separate, permission-checked route that lands
       * with the RBAC layer in P2.
       */
      tools: p.manifest.tools,
      /** True when the loaded runtime actually implements the invokeTool seam. */
      supportsToolInvocation: typeof p.runtime.invokeTool === "function",
    };
  }
}
