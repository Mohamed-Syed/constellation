import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { AuditService } from "../audit/audit.service.js";
import { CreateTaskDto } from "./dto/create-task.dto.js";
import { EngineAvailabilityService, EngineUnavailableError } from "./engine-availability.service.js";
import { ModelRouterService } from "./model-router.service.js";
import { TaskQueueService } from "./task-queue.service.js";
import { TaskService } from "./task.service.js";

/**
 * Engine REST API.
 *
 * POST /api/engine/tasks            — submit a task to the agent queue
 * GET  /api/engine/tasks            — list tasks (newest first, max 100)
 * GET  /api/engine/tasks/:id        — task detail + full step history
 * POST /api/engine/tasks/:id/cancel — cancel a queued or running task
 * POST /api/engine/tasks/:id/approve — grant a paused task's pending tool call
 * POST /api/engine/tasks/:id/reject  — fail a paused task ("rejected by <user>")
 * GET  /api/engine/health           — engine availability + queue + model router health (@Public)
 *
 * All mutation routes require a valid bearer token (the global JwtAuthGuard
 * applies). Granular engine permissions (core:engine:task:submit etc.) are
 * defined in the SDK's CorePermissions and can be layered on later; today
 * any authenticated user can submit tasks. approve/reject are audited so the
 * human decision trail is accountable (tightening them to an admin-only
 * permission is a one-line follow-up).
 *
 * ENGINE UNAVAILABILITY (Engine v0.1): when Redis is down or REDIS_URL is
 * unset, the engine disables itself (see EngineAvailabilityService). The
 * platform still boots healthy; submission returns a clean 503 instead of
 * hanging; `/health` reports `engine:"unavailable"` with a reason.
 */
@Controller("engine")
export class EngineController {
  private readonly logger = new Logger(EngineController.name);

  constructor(
    private readonly tasks: TaskService,
    private readonly queue: TaskQueueService,
    private readonly modelRouter: ModelRouterService,
    private readonly availability: EngineAvailabilityService,
    private readonly audit: AuditService,
  ) {}

  @Post("tasks")
  async submitTask(
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    // Fail fast when the engine backend is down — before creating a DB row
    // that would be stuck in "queued" forever.
    if (!this.availability.isEnabled) {
      throw new ServiceUnavailableException(
        `Engine unavailable: ${this.availability.reason ?? "engine queue disabled"}`,
      );
    }

    const task = await this.tasks.create(dto, user?.id);
    try {
      await this.queue.enqueue(task.id);
    } catch (err) {
      if (err instanceof EngineUnavailableError) {
        // Redis died between the check and the enqueue — leave an honest
        // trail on the task instead of a phantom "queued" row.
        await this.tasks.markFailed(task.id, err.message);
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }
    this.logger.log(`Task ${task.id} queued by ${user?.id ?? "unknown"}: "${dto.title}"`);
    return { id: task.id, status: task.status, title: task.title, createdAt: task.createdAt };
  }

  @Get("tasks")
  async listTasks() {
    return this.tasks.findAll();
  }

  @Get("tasks/:id")
  async getTask(@Param("id") id: string) {
    const task = await this.tasks.findOne(id);
    if (!task) throw new NotFoundException(`Task "${id}" not found`);
    return task;
  }

  @Post("tasks/:id/cancel")
  async cancelTask(@Param("id") id: string) {
    const cancelled = await this.tasks.cancel(id);
    if (!cancelled) {
      throw new BadRequestException(`Task "${id}" cannot be cancelled (not found or already terminal)`);
    }
    return { id, status: "cancelled" };
  }

  /**
   * Approve a paused task's pending tool call: re-enqueue the task; on
   * resume the worker executes the just-approved call (skipping the gate for
   * that one step — `approvedStepIndex` is honoured once) and continues.
   */
  @Post("tasks/:id/approve")
  async approveTask(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) {
    const task = await this.tasks.findOne(id);
    if (!task) throw new NotFoundException(`Task "${id}" not found`);
    if (task.status !== "paused") {
      throw new BadRequestException(`Task "${id}" is not paused (status: ${task.status}) — nothing to approve`);
    }

    const approvedStepIndex = await this.tasks.approvePendingApproval(id);
    if (approvedStepIndex == null) {
      throw new BadRequestException(`Task "${id}" has no pending tool call to approve`);
    }

    if (!this.availability.isEnabled) {
      throw new ServiceUnavailableException(
        `Engine unavailable: ${this.availability.reason ?? "engine queue disabled"}`,
      );
    }

    await this.tasks.markQueued(id);
    try {
      await this.queue.enqueue(id);
    } catch (err) {
      // Redis died mid-flight — the approval is still pending, so restore
      // paused and let the human retry once the engine is back.
      await this.tasks.markPaused(id);
      if (err instanceof EngineUnavailableError) throw new ServiceUnavailableException(err.message);
      throw err;
    }

    await this.audit.record(user?.id ?? null, "engine.task.approved", id, {
      approvedStepIndex,
      actor: user?.email,
    });
    this.logger.log(`Task ${id} approved by ${user?.email ?? "unknown"} (step ${approvedStepIndex})`);
    return { id, status: "queued", approvedStepIndex };
  }

  /** Reject a paused task's pending tool call: fail the task with a clear reason. */
  @Post("tasks/:id/reject")
  async rejectTask(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) {
    const task = await this.tasks.findOne(id);
    if (!task) throw new NotFoundException(`Task "${id}" not found`);
    if (task.status !== "paused") {
      throw new BadRequestException(`Task "${id}" is not paused (status: ${task.status}) — nothing to reject`);
    }

    const reason = `Rejected by ${user?.email ?? "unknown"}`;
    await this.tasks.markFailed(id, reason);
    await this.audit.record(user?.id ?? null, "engine.task.rejected", id, { actor: user?.email });
    this.logger.warn(`Task ${id} rejected by ${user?.email ?? "unknown"}`);
    return { id, status: "failed", reason };
  }

  @Public()
  @Get("health")
  async health() {
    const model = await this.modelRouter.health();
    const queue = await this.queue.getHealth();
    return {
      engine: this.availability.isEnabled ? "available" : "unavailable",
      reason: this.availability.reason,
      queue,
      model,
      timestamp: new Date().toISOString(),
    };
  }
}
