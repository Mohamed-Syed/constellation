import { Module } from "@nestjs/common";
import { PluginContextFactory } from "./plugin-context.factory.js";
import { PluginHealthService } from "./plugin-health.service.js";
import { PluginLifecycleService } from "./plugin-lifecycle.service.js";
import { PluginLoaderService } from "./plugin-loader.service.js";
import { PluginRegistryService } from "./plugin-registry.service.js";
import { PluginsController } from "./plugins.controller.js";

/**
 * The plugin subsystem: registry (state) + loader (discovery/dependency
 * ordering/lifecycle) + lifecycle service (enable/disable) + health poller +
 * read API. Registry and lifecycle are exported so other core modules
 * (health, admin) can inspect/drive loaded plugins.
 */
@Module({
  controllers: [PluginsController],
  providers: [
    PluginRegistryService,
    PluginContextFactory,
    PluginLifecycleService,
    PluginLoaderService,
    PluginHealthService,
  ],
  exports: [PluginRegistryService, PluginLifecycleService],
})
export class PluginsModule {}
