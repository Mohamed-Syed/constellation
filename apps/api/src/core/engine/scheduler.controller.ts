import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { AuditService } from "../audit/audit.service.js";
import { TeamService } from "../teams/team.service.js";
import { CronParseError } from "./cron.js";
import { CreateScheduleDto } from "./dto/scheduler.dto.js";
import { ScheduledTaskService } from "./scheduled-task.service.js";
import { SchedulerEngineService } from "./scheduler-engine.service.js";

/**
 * Engine v0.4 scheduler REST API (autonomous triggers).
 *
 *   POST   /api/engine/schedules           — create a schedule (cron | event)
 *   GET    /api/engine/schedules           — list schedules
 *   GET    /api/engine/schedules/:id       — schedule detail
 *   POST   /api/engine/schedules/:id/enable  — enable (recomputes nextRunAt for cron)
 *   POST   /api/engine/schedules/:id/disable — disable
 *   DELETE /api/engine/schedules/:id       — delete a schedule
 *
 * All routes are authenticated (the global JwtAuthGuard applies); mutations
 * are audited so the autonomous-trigger configuration trail is accountable.
 * A malformed crontab expression is rejected with a clear 400
 * (CronParseError -> BadRequestException). Schedule mutations notify the
 * SchedulerEngineService so newly-created event schedules pick up listeners
 * without a restart.
 */
@Controller("engine")
export class SchedulerController {
  private readonly logger = new Logger(SchedulerController.name);

  constructor(
    private readonly schedules: ScheduledTaskService,
    private readonly scheduler: SchedulerEngineService,
    private readonly audit: AuditService,
    private readonly teams: TeamService,
  ) {}

  @Post("schedules")
  async createSchedule(@Body() dto: CreateScheduleDto, @CurrentUser() user: AuthPrincipal) {
    let schedule;
    try {
      // BG3 team-scoping: a non-admin may only create a schedule under a team
      // they're a member of; a global (teamId unset) schedule requires admin.
      if (dto.teamId && !(await this.canAccessTeam(user, dto.teamId))) {
        throw new ForbiddenException("You are not a member of this team.");
      }
      if (!dto.teamId && !(user?.permissions?.includes("platform:admin") ?? false)) {
        throw new ForbiddenException("Only admins may create team-global schedules.");
      }
      schedule = await this.schedules.create(dto, user?.id ?? null);
    } catch (err) {
      if (err instanceof CronParseError) {
        throw new BadRequestException(`Invalid schedule: ${err.message}`);
      }
      throw err;
    }
    await this.audit.record(user?.id ?? null, "engine.schedule.created", schedule.id, {
      name: schedule.name,
      kind: schedule.kind,
      actor: user?.email,
    });
    await this.scheduler.refreshEventListeners();
    this.logger.log(`Schedule ${schedule.id} ("${schedule.name}", ${schedule.kind}) created by ${user?.email ?? "unknown"}`);
    return schedule;
  }

  @Get("schedules")
  async listSchedules(@CurrentUser() user: AuthPrincipal) {
    const all = await this.schedules.findAll();
    if (user?.permissions?.includes("platform:admin")) return all;
    const myTeams = (await this.teams.listForUser(user?.id ?? null)).map((t) => t.id);
    // Non-admins see only their own + their teams' schedules (global/other-team
    // schedules are admin-only).
    return all.filter((s) => s.teamId === null ? s.createdBy === user?.id : myTeams.includes(s.teamId));
  }

  /** A caller may manage (view/act on) a schedule when admin, the owner, or a member of its team. */
  private async assertCanManageSchedule(
    user: AuthPrincipal,
    schedule: { id: string; teamId: string | null; createdBy: string | null },
  ): Promise<void> {
    if (user?.permissions?.includes("platform:admin")) return;
    if (schedule.createdBy && schedule.createdBy === user?.id) return;
    if (schedule.teamId && (await this.teams.isMember(user?.id ?? null, schedule.teamId))) return;
    throw new ForbiddenException("You cannot manage this schedule.");
  }

  /** A caller may create a schedule under a team only if they're a member; global requires admin. */
  private async canAccessTeam(user: AuthPrincipal, teamId: string): Promise<boolean> {
    if (user?.permissions?.includes("platform:admin")) return true;
    return this.teams.isMember(user?.id ?? null, teamId);
  }

  @Get("schedules/:id")
  async getSchedule(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) {
    const schedule = await this.schedules.findOne(id);
    if (!schedule) throw new NotFoundException(`Schedule "${id}" not found`);
    await this.assertCanManageSchedule(user, schedule);
    return schedule;
  }

  @Post("schedules/:id/enable")
  async enableSchedule(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) {
    const sched = await this.schedules.findOne(id);
    if (!sched) throw new NotFoundException(`Schedule "${id}" not found`);
    await this.assertCanManageSchedule(user, sched);
    const updated = await this.schedules.enable(id);
    if (!updated) throw new NotFoundException(`Schedule "${id}" not found`);
    await this.audit.record(user?.id ?? null, "engine.schedule.enabled", id, { actor: user?.email });
    await this.scheduler.refreshEventListeners();
    this.logger.log(`Schedule ${id} enabled by ${user?.email ?? "unknown"}`);
    return updated;
  }

  @Post("schedules/:id/disable")
  async disableSchedule(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) {
    const sched = await this.schedules.findOne(id);
    if (!sched) throw new NotFoundException(`Schedule "${id}" not found`);
    await this.assertCanManageSchedule(user, sched);
    const updated = await this.schedules.disable(id);
    if (!updated) throw new NotFoundException(`Schedule "${id}" not found`);
    await this.audit.record(user?.id ?? null, "engine.schedule.disabled", id, { actor: user?.email });
    this.logger.log(`Schedule ${id} disabled by ${user?.email ?? "unknown"}`);
    return updated;
  }

  @Delete("schedules/:id")
  async deleteSchedule(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) {
    const sched = await this.schedules.findOne(id);
    if (!sched) throw new NotFoundException(`Schedule "${id}" not found`);
    await this.assertCanManageSchedule(user, sched);
    const removed = await this.schedules.remove(id);
    if (!removed) throw new NotFoundException(`Schedule "${id}" not found`);
    await this.audit.record(user?.id ?? null, "engine.schedule.deleted", id, { actor: user?.email });
    this.logger.log(`Schedule ${id} deleted by ${user?.email ?? "unknown"}`);
    return { id, deleted: true };
  }
}
