import { Module } from "@nestjs/common";
import { PluginContextFactory } from "./plugin-context.factory.js";
import { PluginHealthService } from "./plugin-health.service.js";
import { PluginLifecycleService } from "./plugin-lifecycle.service.js";
import { PluginLoaderService } from "./plugin-loader.service.js";
import { PluginRegistryService } from "./plugin-registry.service.js";
import { PluginSandboxService } from "./plugin-sandbox.service.js";
import { PluginToolService } from "./plugin-tool.service.js";
import { PluginsController } from "./plugins.controller.js";

/**
 * The plugin subsystem: registry (state) + loader (discovery/dependency
 * ordering/lifecycle) + lifecycle service (enable/disable) + health poller +
 * read API, plus `PluginToolService` — the agent-plane dispatcher that
 * resolves and permission-checks a declared tool before running plugin code.
 * Registry, lifecycle, and the tool dispatcher are exported so other core
 * modules (health, admin, and a future agent orchestrator) can inspect/drive
 * loaded plugins and call their tools without going through HTTP.
 */
@Module({
  controllers: [PluginsController],
  providers: [
    PluginRegistryService,
    PluginContextFactory,
    PluginLifecycleService,
    PluginLoaderService,
    PluginHealthService,
    PluginSandboxService,
    PluginToolService,
  ],
  exports: [PluginRegistryService, PluginLifecycleService, PluginToolService],
})
export class PluginsModule {}
