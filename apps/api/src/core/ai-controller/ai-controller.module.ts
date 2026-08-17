import { Module, forwardRef } from "@nestjs/common";
import { EngineModule } from "../engine/engine.module.js";
import { MeshModule } from "../mesh/mesh.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { PluginsModule } from "../plugins/plugins.module.js";
import { AiController } from "./ai-controller.controller.js";
import { ControllerService } from "./controller.service.js";
import { ControllerWatchService } from "./controller-watch.service.js";

/**
 * Phase 5.0 — AGENTIC AI CONTROLLER. Provides the platform's own operator: a
 * live stability snapshot (ControllerService.monitor) + a whitelisted safe
 * recovery runner (ControllerService.act) + the AUTONOMOUS watch loop
 * (ControllerWatchService — scores on a cadence, notifies on transitions,
 * runs safe recovery actions by itself). Imports the engine + mesh + notify +
 * plugins modules so it can read live subsystem health and run mesh/task/
 * supervisor-safe actions.
 */
@Module({
  imports: [forwardRef(() => EngineModule), MeshModule, NotificationsModule, PluginsModule],
  controllers: [AiController],
  providers: [ControllerService, ControllerWatchService],
  exports: [ControllerService, ControllerWatchService],
})
export class AiControllerModule {}
