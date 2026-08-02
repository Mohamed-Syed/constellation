import { Module } from "@nestjs/common";
import { PluginsModule } from "../plugins/plugins.module.js";
import { AgentWorkerService } from "./agent-worker.service.js";
import { EngineController } from "./engine.controller.js";
import { ModelRouterService } from "./model-router.service.js";
import { TaskQueueService } from "./task-queue.service.js";
import { TaskService } from "./task.service.js";

/**
 * Engine v0 — Durable Task Runtime.
 *
 * Wires the four engine services together and exposes the REST API.
 * PluginsModule is imported so AgentWorkerService can inject
 * PluginToolService and PluginRegistryService for tool dispatch.
 *
 * Activation: add EngineModule to AppModule.imports (after PluginsModule).
 */
@Module({
  imports: [PluginsModule],
  controllers: [EngineController],
  providers: [
    TaskService,
    TaskQueueService,
    AgentWorkerService,
    ModelRouterService,
  ],
  exports: [TaskService, TaskQueueService],
})
export class EngineModule {}
