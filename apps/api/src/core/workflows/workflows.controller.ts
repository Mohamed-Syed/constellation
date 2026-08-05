import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CorePermissions } from "@constellation/plugin-sdk";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { AuditService } from "../audit/audit.service.js";
import { PermissionsGuard } from "../rbac/permissions.guard.js";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { WorkflowService } from "./workflow.service.js";
import { WorkflowRunService } from "./workflow-run.service.js";
import { WorkflowTriggerService, type WorkflowTriggerInput } from "./workflow-trigger.service.js";

/**
 * Phase 3.0 — visual workflow builder: REST surface for stored workflow
 * definitions + their runs. All routes require `core:workflow:manage`
 * (`platform:admin` implies it, so the seeded admin works out of the box).
 * Mutations are audited like the plugin routes.
 */
@ApiTags("workflows")
@Controller("workflows")
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowService,
    private readonly runs: WorkflowRunService,
    private readonly triggers: WorkflowTriggerService,
    private readonly audit: AuditService,
  ) {}

  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.WORKFLOW_MANAGE)
  @Post()
  @ApiOkResponse({ description: "Create a workflow definition." })
  async create(@Body() body: { name?: unknown; description?: unknown; definition?: unknown }, @CurrentUser() user?: AuthPrincipal) {
    this.requireName(body.name);
    await this.audit.record(user?.id ?? null, "workflow.create", String(body.name ?? ""));
    const row = await this.workflows.create({
      name: String(body.name),
      description: body.description === undefined ? undefined : String(body.description),
      definition: body.definition,
    });
    // Workflow triggers round: arm the cron schedule / event listener.
    await this.triggers.sync(row as unknown as WorkflowTriggerInput);
    return row;
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.WORKFLOW_MANAGE)
  @Get()
  @ApiOkResponse({ description: "List every workflow definition (newest first)." })
  list() {
    return this.workflows.findAll();
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.WORKFLOW_MANAGE)
  @Get(":id")
  @ApiOkResponse({ description: "One workflow + its recent runs." })
  async get(@Param("id") id: string) {
    const row = await this.workflows.findOne(id);
    if (!row) throw new NotFoundException(`Workflow "${id}" not found`);
    return row;
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.WORKFLOW_MANAGE)
  @Put(":id")
  @ApiOkResponse({ description: "Update a workflow definition." })
  async update(
    @Param("id") id: string,
    @Body() body: { name?: unknown; description?: unknown; definition?: unknown },
    @CurrentUser() user?: AuthPrincipal,
  ) {
    if (body.name !== undefined) this.requireName(body.name);
    await this.audit.record(user?.id ?? null, "workflow.update", id);
    const row = await this.workflows.update(id, {
      name: body.name === undefined ? undefined : String(body.name),
      description: body.description === undefined ? undefined : String(body.description),
      definition: body.definition,
    });
    if (!row) throw new NotFoundException(`Workflow "${id}" not found`);
    // Workflow triggers round: re-arm the schedule / listener to the new trigger.
    await this.triggers.sync(row as unknown as WorkflowTriggerInput);
    return row;
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.WORKFLOW_MANAGE)
  @Delete(":id")
  @ApiOkResponse({ description: "Delete a workflow." })
  async remove(@Param("id") id: string, @CurrentUser() user?: AuthPrincipal) {
    const removed = await this.workflows.remove(id);
    if (!removed) throw new NotFoundException(`Workflow "${id}" not found`);
    await this.audit.record(user?.id ?? null, "workflow.delete", id);
    // Workflow triggers round: disarm the schedule + listener.
    await this.triggers.remove(id);
    return { id, removed: true };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.WORKFLOW_MANAGE)
  @Post(":id/run")
  @ApiOkResponse({ description: "Trigger a manual run; returns the run id." })
  async run(@Param("id") id: string, @CurrentUser() user?: AuthPrincipal) {
    const run = await this.runs.run(id);
    await this.audit.record(user?.id ?? null, "workflow.run", id);
    return { id: run.id, workflowId: id, status: run.status };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.WORKFLOW_MANAGE)
  @Get(":id/runs/:runId")
  @ApiOkResponse({ description: "One run's outcome trail." })
  getRun(@Param("runId") runId: string) {
    return this.runs.findRun(runId);
  }

  private requireName(name: unknown): void {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new BadRequestException("Workflow name is required");
    }
  }
}
