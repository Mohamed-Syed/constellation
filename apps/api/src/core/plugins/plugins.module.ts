import { Module } from "@nestjs/common";
import { PluginLoaderService } from "./plugin-loader.service.js";
import { PluginRegistryService } from "./plugin-registry.service.js";
import { PluginsController } from "./plugins.controller.js";

/**
 * The plugin subsystem: registry (state) + loader (discovery/lifecycle) +
 * read API. Exported registry lets other core modules (health, admin) inspect
 * loaded plugins.
 */
@Module({
  controllers: [PluginsController],
  providers: [PluginRegistryService, PluginLoaderService],
  exports: [PluginRegistryService],
})
export class PluginsModule {}
