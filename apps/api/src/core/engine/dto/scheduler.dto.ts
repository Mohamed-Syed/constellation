import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * Scheduler DTOs (Engine v0.4 — autonomous triggers). Mirrors the established
 * class-validator style of `create-task.dto.ts`; validation errors surface as
 * NestJS's standard 400 (the global ValidationPipe).
 *
 * A schedule captures a task TEMPLATE (`task.title` / `task.prompt` /
 * `task.model` / `task.maxSteps` / `task.maxTokens`) plus a trigger:
 *   - kind "cron"  -> `cron` (5-field crontab) + optional `timezone`
 *   - kind "event" -> `event` (a platform EventBus topic, e.g. "scheduler.ping")
 *
 * The well-formedness of the cron expression itself is validated in the
 * service (a `CronParseError` => 400), not here — class-validator has no cron
 * validator and the scheduler owns its own hand-rolled parser.
 */

/** The task template enqueued when a schedule fires. Mirrors CreateTaskDto's fields. */
export class ScheduleTaskTemplateDto {
  @IsString()
  title!: string;

  @IsString()
  prompt!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxSteps?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxTokens?: number;
}

export class CreateScheduleDto {
  @IsString()
  name!: string;

  @IsIn(["cron", "event"])
  kind!: "cron" | "event";

  /** 5-field crontab expression. Required when kind === "cron". */
  @IsOptional()
  @IsString()
  cron?: string;

  /** IANA timezone for the cron expression. Optional; defaults to server tz. */
  @IsOptional()
  @IsString()
  timezone?: string;

  /** Platform EventBus topic that fires this schedule. Required when kind === "event". */
  @IsOptional()
  @IsString()
  event?: string;

  /** The task template to enqueue when the schedule fires. */
  @ValidateNested()
  @Type(() => ScheduleTaskTemplateDto)
  task!: ScheduleTaskTemplateDto;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** Minimal enable/disable payload — reserved for future per-patch options. */
export class ToggleScheduleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
