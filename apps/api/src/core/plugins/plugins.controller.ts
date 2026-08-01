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
    }));
  }

  @Get(":id")
  @ApiOkResponse({ description: "Full manifest + state for one plugin." })
  get(@Param("id") id: string) {
    const p = this.registry.get(id);
    if (!p) throw new NotFoundException(`No plugin "${id}"`);
    return { ...p.manifest, state: p.state, error: p.error };
  }
}
