import { Module, forwardRef } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { EngineModule } from "../engine/engine.module.js";
import { PluginsModule } from "../plugins/plugins.module.js";
import { WorkflowService } from "./workflow.service.js";
import { WorkflowRunService } from "./workflow-run.service.js";
import { WorkflowTriggerService } from "./workflow-trigger.service.js";
import { WorkflowsController } from "./workflows.controller.js";

/**
 * Phase 3.0 — visual workflow builder module. Imports EngineModule (task +
 * queue services for agent steps) and PluginsModule (PluginToolService for
 * tool steps); owns the Workflow/WorkflowRun persistence + the executor.
 * The EngineModule import is forwardRef'd because the scheduler now runs
 * workflow schedules (EngineModule imports this module back — the standard
 * bidirectional Nest pattern).
 */
@Module({
  imports: [DatabaseModule, forwardRef(() => EngineModule), PluginsModule],
  controllers: [WorkflowsController],
  providers: [WorkflowService, WorkflowRunService, WorkflowTriggerService],
  exports: [WorkflowService, WorkflowRunService],
})
export class WorkflowsModule {}
