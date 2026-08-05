import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { AuditService } from "../audit/audit.service.js";
import { TeamService } from "../teams/team.service.js";
import { DelegationService, type DelegateChildInput } from "./delegation.service.js";
import { EngineAlertService } from "./engine-alerts.service.js";
import { DEAD_LETTER_LIMIT } from "./dead-letter.js";
import { CreateTaskDto } from "./dto/create-task.dto.js";
import { EngineAvailabilityService, EngineUnavailableError } from "./engine-availability.service.js";
import { ModelRouterService } from "./model-router.service.js";
import { SchedulerEngineService } from "./scheduler-engine.service.js";
import { SupervisorService } from "./supervisor.service.js";
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
    private readonly scheduler: SchedulerEngineService,
    private readonly supervisor: SupervisorService,
    private readonly alerts: EngineAlertService,
    private readonly teams: TeamService,
    private readonly delegation: DelegationService,
  ) {}

  @Post("tasks")
  async submitTask(
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    // Team spaces round: submitting INTO a team requires membership (or admin).
    if (dto.teamId && !(await this.canAccessTeam(user, dto.teamId))) {
      throw new ForbiddenException("You are not a member of this team.");
    }
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
  async listTasks(@CurrentUser() user: AuthPrincipal, @Query("teamId") teamId?: string) {
    // Team spaces round: a team filter requires membership (or admin); a
    // non-admin without a filter sees only their PERSONAL tasks.
    if (teamId && !(await this.canAccessTeam(user, teamId))) {
      throw new ForbiddenException("You are not a member of this team.");
    }
    const isAdmin = user?.permissions?.includes("platform:admin") ?? false;
    if (!isAdmin) {
      // Non-admins: personal tasks (actorId = me), plus their teams' tasks.
      const myTeams = (await this.teams.listForUser(user?.id ?? null)).map((t) => t.id);
      return this.tasks.findAll({ teamId: teamId ?? undefined, actorId: user?.id ?? null, teamIds: myTeams });
    }
    return this.tasks.findAll({ teamId: teamId ?? undefined });
  }

  /** Members + platform admins may access a team's tasks. */
  private async canAccessTeam(user: AuthPrincipal | undefined, teamId: string): Promise<boolean> {
    if (user?.permissions?.includes("platform:admin")) return true;
    return this.teams.isMember(user?.id ?? null, teamId);
  }

  /** Visibility: owner, platform admin, or a member of the task's team. */
  private async assertCanSeeTask(task: Record<string, unknown> | null, user: AuthPrincipal | undefined): Promise<void> {
    if (!task) throw new NotFoundException("Task not found.");
    if (user?.permissions?.includes("platform:admin")) return;
    const owner = user?.id && task.actorId === user.id;
    if (owner) return;
    const teamId = task.teamId;
    if (typeof teamId === "string" && (await this.canAccessTeam(user, teamId))) return;
    throw new ForbiddenException("You cannot access this task.");
  }

  /** Crews round (Phase 4.0 4.1): children of a task. */
  @Get("tasks/:id/children")
  async taskChildren(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) {
    const task = await this.tasks.findOne(id);
    await this.assertCanSeeTask(task, user);
    return { items: await this.delegation.childrenOf(id) };
  }

  /** Crews round: the full delegation tree under a task. */
  @Get("tasks/:id/tree")
  async taskTree(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) {
    const task = await this.tasks.findOne(id);
    await this.assertCanSeeTask(task, user);
    return this.delegation.tree(id);
  }

  /** Crews round: delegate a sub-agent task under this task. */
  @Post("tasks/:id/delegate")
  async delegateTask(
    @Param("id") id: string,
    @Body() dto: DelegateChildInput,
    @CurrentUser() user: AuthPrincipal,
  ) {
    const task = await this.tasks.findOne(id);
    await this.assertCanSeeTask(task, user);
    const child = await this.delegation.spawnChild(id, dto);
    if (!child) throw new BadRequestException("Cannot delegate: parent not found.");
    return { ok: true, task: child };
  }

  /**
   * Engine v0.5 — structured dead-letter view. Failed tasks (newest first,
   * capped) each carrying their failure classification + final error, so
   * operators can see WHY a task died without consulting BullMQ.
   */
  @Get("deadletters")
  async listDeadLetters() {
    return this.tasks.findAllFailed(DEAD_LETTER_LIMIT);
  }

  /** Engine v0.5 — recent alert trail (in-memory ring buffer, newest first). */
  @Get("alerts")
  async listAlerts() {
    return this.alerts.getAlertSummary();
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
    await this.tasks.markFailed(id, reason, "rejected");
    await this.audit.record(user?.id ?? null, "engine.task.rejected", id, { actor: user?.email });
    this.logger.warn(`Task ${id} rejected by ${user?.email ?? "unknown"}`);
    return { id, status: "failed", reason };
  }

  @Public()
  @Get("health")
  async health() {
    const model = await this.modelRouter.health();
    const queue = await this.queue.getHealth();
    const scheduler = await this.scheduler.getHealth();
    const supervision = await this.supervisor.getHealth();
    // Engine v0.5 — the DURABLE dead-letter count (failed TASK rows), distinct
    // from BullMQ's failed-JOB count (which is what `queue.failed` reports).
    const failedTasks = await this.tasks.getFailedCount();
    return {
      engine: this.availability.isEnabled ? "available" : "unavailable",
      reason: this.availability.reason,
      queue: { ...queue, failedTasks },
      model,
      scheduler,
      supervision,
      alerts: await this.alerts.getAlertSummary(),
      timestamp: new Date().toISOString(),
    };
  }
}
