import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { EngineModule } from "../engine/engine.module.js";
import { PluginsModule } from "../plugins/plugins.module.js";
import { WorkflowService } from "./workflow.service.js";
import { WorkflowRunService } from "./workflow-run.service.js";
import { WorkflowsController } from "./workflows.controller.js";

/**
 * Phase 3.0 — visual workflow builder module. Imports EngineModule (task +
 * queue services for agent steps) and PluginsModule (PluginToolService for
 * tool steps); owns the Workflow/WorkflowRun persistence + the executor.
 */
@Module({
  imports: [DatabaseModule, EngineModule, PluginsModule],
  controllers: [WorkflowsController],
  providers: [WorkflowService, WorkflowRunService],
  exports: [WorkflowService, WorkflowRunService],
})
export class WorkflowsModule {}
