import { Module } from "@nestjs/common";
import { PluginsModule } from "../plugins/plugins.module.js";
import { AgentWorkerService } from "./agent-worker.service.js";
import { EngineAvailabilityService } from "./engine-availability.service.js";
import { EngineController } from "./engine.controller.js";
import { MODEL_PROVIDERS } from "./model-provider.js";
import { ModelRouterService } from "./model-router.service.js";
import { OllamaModelProvider } from "./ollama-model-provider.js";
import { OpenRouterModelProvider } from "./openrouter-model-provider.js";
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
    // Model plane: OllamaModelProvider is the $0 default; OpenRouterModelProvider
    // (Engine v0.3) is the OPT-IN cloud provider — unconfigured it reports
    // honest health and the router never selects it. ModelRouterService routes
    // between them by canHandleModel with fallback to Ollama. Add another
    // provider by registering it here and appending it to the factory array —
    // callers never change.
    OllamaModelProvider,
    OpenRouterModelProvider,
    {
      provide: MODEL_PROVIDERS,
      useFactory: (ollama: OllamaModelProvider, openrouter: OpenRouterModelProvider) => [ollama, openrouter],
      inject: [OllamaModelProvider, OpenRouterModelProvider],
    },
    ModelRouterService,
    EngineAvailabilityService,
  ],
  exports: [TaskService, TaskQueueService],
})
export class EngineModule {}
