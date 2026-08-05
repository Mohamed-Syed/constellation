import { Module, forwardRef } from "@nestjs/common";
import { PluginsModule } from "../plugins/plugins.module.js";
import { TeamsModule } from "../teams/teams.module.js";
import { WorkflowsModule } from "../workflows/workflows.module.js";
import { AgentWorkerService } from "./agent-worker.service.js";
import { DeepSeekModelProvider } from "./deepseek-model-provider.js";
import { EngineAlertService } from "./engine-alerts.service.js";
import { EngineAvailabilityService } from "./engine-availability.service.js";
import { EngineController } from "./engine.controller.js";
import { MODEL_PROVIDERS } from "./model-provider.js";
import { ModelRouterService } from "./model-router.service.js";
import { OllamaModelProvider } from "./ollama-model-provider.js";
import { OpenRouterModelProvider } from "./openrouter-model-provider.js";
import { ScheduledTaskService } from "./scheduled-task.service.js";
import { SchedulerController } from "./scheduler.controller.js";
import { SchedulerEngineService } from "./scheduler-engine.service.js";
import { SupervisorService } from "./supervisor.service.js";
import { TaskQueueService } from "./task-queue.service.js";
import { TaskService } from "./task.service.js";

/**
 * Engine v0.1 — Durable Task Runtime + Engine v0.4 — Scheduler / Autonomous Triggers.
 *
 * Wires the engine services together and exposes the REST API.
 * PluginsModule is imported so AgentWorkerService can inject
 * PluginToolService and PluginRegistryService for tool dispatch.
 *
 * EngineAvailabilityService probes Redis at boot with a fail-fast client;
 * TaskQueueService/AgentWorkerService only construct their BullMQ
 * Queue/Worker when the backend is reachable (boot-with-no-infra invariant).
 * SchedulerEngineService (v0.4) polls for due cron schedules and listens for
 * event-triggered schedules via the globally exported EventBusService.
 *
 * Activation: add EngineModule to AppModule.imports (after PluginsModule).
 */
@Module({
  imports: [PluginsModule, forwardRef(() => WorkflowsModule), TeamsModule],
  controllers: [EngineController, SchedulerController],
  providers: [
    TaskService,
    TaskQueueService,
    AgentWorkerService,
    ScheduledTaskService,
    SchedulerEngineService,
    SupervisorService,
    EngineAlertService,
    // Model plane: OllamaModelProvider is the $0 default; OpenRouterModelProvider
    // (Engine v0.3) and DeepSeekModelProvider (2026-08-04) are the OPT-IN cloud
    // providers — unconfigured they report honest health and the router never
    // selects them. ModelRouterService routes between them by canHandleModel
    // with fallback to Ollama. Add another provider by registering it here and
    // appending it to the factory array — callers never change.
    OllamaModelProvider,
    OpenRouterModelProvider,
    DeepSeekModelProvider,
    {
      provide: MODEL_PROVIDERS,
      useFactory: (
        ollama: OllamaModelProvider,
        openrouter: OpenRouterModelProvider,
        deepseek: DeepSeekModelProvider,
      ) => [ollama, openrouter, deepseek],
      inject: [OllamaModelProvider, OpenRouterModelProvider, DeepSeekModelProvider],
    },
    ModelRouterService,
    EngineAvailabilityService,
  ],
  exports: [TaskService, TaskQueueService, ScheduledTaskService, SchedulerEngineService, SupervisorService, EngineAlertService, EngineAvailabilityService, ModelRouterService],
})
export class EngineModule {}
