import { Module } from "@nestjs/common";
import { PluginsModule } from "../plugins/plugins.module.js";
import { AgentWorkerService } from "./agent-worker.service.js";
import { EngineAvailabilityService } from "./engine-availability.service.js";
import { EngineController } from "./engine.controller.js";
import { ModelRouterService } from "./model-router.service.js";
import { TaskQueueService } from "./task-queue.service.js";
import { TaskService } from "./task.service.js";

/**
 * Engine v0.1 — Durable Task Runtime.
 *
 * Wires the engine services together and exposes the REST API.
 * PluginsModule is imported so AgentWorkerService can inject
 * PluginToolService and PluginRegistryService for tool dispatch.
 *
 * EngineAvailabilityService probes Redis at boot with a fail-fast client;
 * TaskQueueService/AgentWorkerService only construct their BullMQ
 * Queue/Worker when the backend is reachable (boot-with-no-infra invariant).
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
    EngineAvailabilityService,
  ],
  exports: [TaskService, TaskQueueService],
})
export class EngineModule {}
