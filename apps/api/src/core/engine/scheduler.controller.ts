import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { AuditService } from "../audit/audit.service.js";
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
  ) {}

  @Post("schedules")
  async createSchedule(@Body() dto: CreateScheduleDto, @CurrentUser() user: AuthPrincipal) {
    let schedule;
    try {
      schedule = await this.schedules.create(dto);
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
  async listSchedules() {
    return this.schedules.findAll();
  }

  @Get("schedules/:id")
  async getSchedule(@Param("id") id: string) {
    const schedule = await this.schedules.findOne(id);
    if (!schedule) throw new NotFoundException(`Schedule "${id}" not found`);
    return schedule;
  }

  @Post("schedules/:id/enable")
  async enableSchedule(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) {
    const updated = await this.schedules.enable(id);
    if (!updated) throw new NotFoundException(`Schedule "${id}" not found`);
    await this.audit.record(user?.id ?? null, "engine.schedule.enabled", id, { actor: user?.email });
    await this.scheduler.refreshEventListeners();
    this.logger.log(`Schedule ${id} enabled by ${user?.email ?? "unknown"}`);
    return updated;
  }

  @Post("schedules/:id/disable")
  async disableSchedule(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) {
    const updated = await this.schedules.disable(id);
    if (!updated) throw new NotFoundException(`Schedule "${id}" not found`);
    await this.audit.record(user?.id ?? null, "engine.schedule.disabled", id, { actor: user?.email });
    this.logger.log(`Schedule ${id} disabled by ${user?.email ?? "unknown"}`);
    return updated;
  }

  @Delete("schedules/:id")
  async deleteSchedule(@Param("id") id: string, @CurrentUser() user: AuthPrincipal) {
    const removed = await this.schedules.remove(id);
    if (!removed) throw new NotFoundException(`Schedule "${id}" not found`);
    await this.audit.record(user?.id ?? null, "engine.schedule.deleted", id, { actor: user?.email });
    this.logger.log(`Schedule ${id} deleted by ${user?.email ?? "unknown"}`);
    return { id, deleted: true };
  }
}
