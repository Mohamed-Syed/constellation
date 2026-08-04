import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service.js";
import { CronParseError, nextRunAfter, parseCron } from "./cron.js";
import type { CreateScheduleDto } from "./dto/scheduler.dto.js";

/** The task template a scheduled task enqueues when it fires. */
export interface ScheduledTaskTemplate {
  title: string;
  prompt: string;
  model?: string;
  maxSteps?: number;
  maxTokens?: number;
}

/** The flexible trigger spec stored in `spec` (Json). */
export interface ScheduledTaskSpec {
  /** 5-field crontab expression (kind "cron"). */
  cron?: string;
  /** IANA timezone string (kind "cron"); the poll loop uses server-local time. */
  timezone?: string;
  /** Platform EventBus topic that fires this schedule (kind "event"). */
  event?: string;
}

/** What the poll loop / event listener passes when firing a schedule. */
export interface FiredSchedule {
  id: string;
  name: string;
  kind: string;
  template: ScheduledTaskTemplate;
}

/** Public shape returned to callers/controllers (matches the Prisma model). */
export type ScheduledTaskRecord = {
  id: string;
  name: string;
  title: string;
  prompt: string;
  model: string | null;
  maxSteps: number;
  maxTokens: number | null;
  kind: string;
  spec: ScheduledTaskSpec;
  enabled: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  runCount: number;
  lastError: string | null;
  /** Workflow triggers round: when set, firing runs this workflow, not a task. */
  workflowId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface ScheduledTaskServiceOptions {
  /** Injectable clock, so tests can advance time without a real timer. */
  now?: () => Date;
}

/**
 * Injection token for optional constructor options. No provider is registered
 * for it in EngineModule, so Nest resolves it to `undefined` in production
 * (falling back to defaults) while offline tests pass a value directly via
 * `new Service(prisma, config, options)`. `@Optional()` keeps an unregistered
 * provider from failing the container at boot.
 */
export const SCHEDULER_SERVICE_OPTIONS = Symbol("SCHEDULER_SERVICE_OPTIONS");

/**
 * CRUD layer for ScheduledTask (Engine v0.4 — recurring / event-triggered
 * task schedules). Follows the exact TaskService pattern: every method guards
 * on `this.prisma.db` and degrades gracefully when there is no database —
 * read methods resolve to safe defaults, only `create` and mutation-style
 * methods throw the documented "Database not available" error.
 *
 * The initial `nextRunAt` for a cron schedule is computed here at create time
 * (via the hand-rolled cron parser), and `markRun` advances it after each
 * fire. Event schedules have no `nextRunAt`.
 */
@Injectable()
export class ScheduledTaskService {
  private readonly logger = new Logger(ScheduledTaskService.name);
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaService,
    config?: ConfigService,
    @Optional() @Inject(SCHEDULER_SERVICE_OPTIONS) options?: ScheduledTaskServiceOptions,
  ) {
    void config;
    this.now = options?.now ?? (() => new Date());
  }

  /**
   * Validate a schedule payload for internal coherence and, for kind "cron",
   * that the crontab expression is well-formed. Throws on any problem so the
   * controller can map it to a clean 400.
   */
  private validateCreate(dto: CreateScheduleDto): ScheduledTaskSpec {
    const spec: ScheduledTaskSpec = {};
    if (dto.kind === "cron") {
      spec.cron = dto.cron ?? "";
      spec.timezone = dto.timezone;
      try {
        parseCron(spec.cron); // throws CronParseError on a bad expression
      } catch (err) {
        if (err instanceof CronParseError) throw err;
        throw new CronParseError(`invalid cron: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      spec.event = dto.event ?? "";
      if (!spec.event) {
        throw new CronParseError('event schedules require an "event" topic');
      }
    }
    return spec;
  }

  private toRecord(row: {
    id: string;
    name: string;
    title: string;
    prompt: string;
    model: string | null;
    maxSteps: number;
    maxTokens: number | null;
    kind: string;
    spec: unknown;
    enabled: boolean;
    nextRunAt: Date | null;
    lastRunAt: Date | null;
    runCount: number;
    lastError: string | null;
    workflowId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): ScheduledTaskRecord {
    return {
      ...row,
      spec: (row.spec as ScheduledTaskSpec | null) ?? {},
    };
  }

  /** Throw the documented error when there is no database. */
  private dbOrThrow(): NonNullable<PrismaService["db"]> {
    const db = this.prisma.db;
    if (!db) throw new Error("Database not available");
    return db;
  }

  async create(dto: CreateScheduleDto): Promise<ScheduledTaskRecord> {
    if (dto.kind === "cron" && !dto.cron) {
      throw new CronParseError('cron schedules require a 5-field "cron" expression');
    }
    const spec = this.validateCreate(dto);
    const db = this.dbOrThrow();

    // Validate the cron here too so the error also surfaces even without a DB.
    let nextRunAt: Date | null = null;
    if (dto.kind === "cron") {
      const next = nextRunAfter(parseCron(spec.cron!), this.now());
      nextRunAt = next;
    }

    const task = dto.task;

    const row = await db.scheduledTask.create({
      data: {
        name: dto.name,
        title: task.title,
        prompt: task.prompt,
        model: task.model ?? null,
        maxSteps: task.maxSteps ?? 20,
        maxTokens: task.maxTokens ?? null,
        kind: dto.kind,
        spec: spec as unknown as Prisma.InputJsonValue,
        workflowId: dto.workflowId ?? null,
        enabled: dto.enabled ?? true,
        nextRunAt,
      },
    });
    return this.toRecord(row);
  }

  async findAll(): Promise<ScheduledTaskRecord[]> {
    const db = this.prisma.db;
    if (!db) return [];
    const rows = await db.scheduledTask.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findOne(id: string): Promise<ScheduledTaskRecord | null> {
    const db = this.prisma.db;
    if (!db) return null;
    const row = await db.scheduledTask.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  /** Set enabled = true and reset nextRunAt to the next cron fire (no-op without a db). Returns null if not found. */
  async enable(id: string): Promise<ScheduledTaskRecord | null> {
    const db = this.dbOrThrow();
    const row = await db.scheduledTask.findUnique({ where: { id } });
    if (!row) return null;
    const spec = (row.spec as ScheduledTaskSpec | null) ?? {};
    let nextRunAt = row.nextRunAt;
    if (row.kind === "cron" && spec.cron) {
      nextRunAt = nextRunAfter(parseCron(spec.cron), this.now());
    }
    const updated = await db.scheduledTask.update({
      where: { id },
      data: { enabled: true, nextRunAt, lastError: null },
    });
    return this.toRecord(updated);
  }

  /** Set enabled = false. Returns null if not found. */
  async disable(id: string): Promise<ScheduledTaskRecord | null> {
    const db = this.dbOrThrow();
    const row = await db.scheduledTask.findUnique({ where: { id } });
    if (!row) return null;
    const updated = await db.scheduledTask.update({
      where: { id },
      data: { enabled: false },
    });
    return this.toRecord(updated);
  }

  /** Hard-delete a schedule. Returns true if a row was removed. */
  async remove(id: string): Promise<boolean> {
    const db = this.dbOrThrow();
    try {
      await db.scheduledTask.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /** List enabled, DUE cron schedules (no nextRunAt yet, or its time has passed `at`). */
  async listDueCronSchedules(at: Date = this.now()): Promise<ScheduledTaskRecord[]> {
    const db = this.prisma.db;
    if (!db) return [];
    const rows = await db.scheduledTask.findMany({
      where: {
        enabled: true,
        kind: "cron",
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: at } }],
      },
      take: 50,
    });
    return rows.map((r) => this.toRecord(r));
  }

  /** List enabled event-triggered schedules (fired by the EventBus, not the clock). */
  async listEnabledEventSchedules(): Promise<ScheduledTaskRecord[]> {
    const db = this.prisma.db;
    if (!db) return [];
    const rows = await db.scheduledTask.findMany({
      where: { enabled: true, kind: "event" },
      take: 50,
    });
    return rows.map((r) => this.toRecord(r));
  }

  /**
   * Advance a schedule's run bookkeeping after it fires: increment runCount,
   * stamp lastRunAt, and (cron kind) compute the next nextRunAt strictly after
   * `at`. `lastError` is cleared on a successful fire. No-op without a db.
   */
  async markRun(id: string, at: Date, lastError?: string | null): Promise<void> {
    const db = this.prisma.db;
    if (!db) return;
    const row = await db.scheduledTask.findUnique({ where: { id } });
    if (!row) return;
    const spec = (row.spec as ScheduledTaskSpec | null) ?? {};
    const data: Prisma.ScheduledTaskUpdateInput = {
      runCount: { increment: 1 },
      lastRunAt: at,
      lastError: lastError ?? null,
    };
    if (row.kind === "cron" && spec.cron) {
      const next = nextRunAfter(parseCron(spec.cron), at);
      data.nextRunAt = next ?? null;
    }
    await db.scheduledTask.update({ where: { id }, data });
  }
}
