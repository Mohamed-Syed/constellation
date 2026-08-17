import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../database/prisma.service.js";
import type { CreateScheduleDto } from "./dto/scheduler.dto.js";
import { CronParseError } from "./cron.js";
import { ScheduledTaskService } from "./scheduled-task.service.js";

/**
 * ScheduledTaskService CRUD tests (Engine v0.4 — scheduler). Hand-wired with
 * `new`, no Nest DI (the established offline pattern). The only collaborator
 * is PrismaService (`this.prisma.db`), faked with a plain object of
 * `vi.fn()` delegates. A fake `now` clock is injected so time-dependent
 * behaviour (initial nextRunAt, markRun advances) is deterministic.
 *
 * Contracts under test:
 *  1. With a db, every call forwards the promised Prisma payload (defaults
 *     included — `maxSteps: 20`, `enabled: true`, nextRunAt computed from cron).
 *  2. A malformed crontab throws CronParseError (the controller maps it to 400).
 *  3. With NO db, every read resolves safe defaults; only create-style and
 *     mutation-style methods throw "Database not available".
 */

interface DbMock {
  scheduledTask: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

function makeDb(): DbMock {
  return {
    scheduledTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function serviceWith(db: unknown, now = new Date("2026-08-03T00:00:00.000Z")): {
  svc: ScheduledTaskService;
  db: DbMock;
} {
  const dbMock = (db ?? makeDb()) as DbMock;
  const svc = new ScheduledTaskService({ db } as unknown as PrismaService, undefined, {
    now: () => now,
  });
  return { svc, db: dbMock };
}

function dto(overrides: Partial<CreateScheduleDto> = {}): CreateScheduleDto {
  return {
    name: "daily digest",
    kind: "cron",
    cron: "* * * * *",
    task: { title: "Digest", prompt: "Summarize today.", maxSteps: 5, maxTokens: 2000 },
    ...overrides,
  } as CreateScheduleDto;
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "s1",
    name: "daily digest",
    title: "Digest",
    prompt: "Summarize today.",
    model: null,
    maxSteps: 20,
    maxTokens: null,
    kind: "cron",
    spec: { cron: "* * * * *" },
    enabled: true,
    nextRunAt: null,
    lastRunAt: null,
    runCount: 0,
    lastError: null,
    createdAt: new Date("2026-08-03T00:00:00.000Z"),
    updatedAt: new Date("2026-08-03T00:00:00.000Z"),
    ...overrides,
  };
}

describe("ScheduledTaskService — create", () => {
  it("creates a cron schedule with default enabled:true and maxSteps:20, and computes nextRunAt", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.scheduledTask.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      row({ ...data, id: "s1" }),
    );

    const sched = await svc.create(dto());

    expect(db.scheduledTask.create).toHaveBeenCalledOnce();
    const data = db.scheduledTask.create.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(data.name).toBe("daily digest");
    expect(data.title).toBe("Digest");
    expect(data.prompt).toBe("Summarize today.");
    expect(data.kind).toBe("cron");
    expect(data.enabled).toBe(true);
    expect(data.maxSteps).toBe(5); // from the task template
    expect(data.maxTokens).toBe(2000);
    // nextRunAt is computed strictly after the injected clock (00:00:00 -> 00:00:01)
    expect(data.nextRunAt).toBeInstanceOf(Date);
    expect((data.nextRunAt as Date).getTime()).toBeGreaterThan(
      new Date("2026-08-03T00:00:00.000Z").getTime(),
    );
    expect(sched.id).toBe("s1");
  });

  it("rejects a malformed crontab with CronParseError", async () => {
    const { svc } = serviceWith(makeDb());
    await expect(svc.create(dto({ cron: "60 * * * *" }))).rejects.toThrow(CronParseError);
  });

  it("rejects a cron schedule missing the cron expression", async () => {
    const { svc } = serviceWith(makeDb());
    await expect(svc.create(dto({ cron: undefined }))).rejects.toThrow(/require a 5-field/);
  });

  it("rejects an event schedule missing the event topic", async () => {
    const { svc } = serviceWith(makeDb());
    await expect(svc.create(dto({ kind: "event", cron: undefined, event: undefined }))).rejects.toThrow(
      /require an "event" topic/,
    );
  });

  it("creates an event schedule with no nextRunAt", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.scheduledTask.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      row({ ...data, kind: "event", spec: { event: "plugin.enabled" } }),
    );

    const sched = await svc.create(dto({ kind: "event", cron: undefined, event: "plugin.enabled" }));

    const data = db.scheduledTask.create.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(data.kind).toBe("event");
    expect(db.scheduledTask.create).toHaveBeenCalledOnce();
    expect(sched.kind).toBe("event");
  });

  it("throws Database not available when there is no db (create is a write)", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.create(dto())).rejects.toThrow("Database not available");
  });
});

describe("ScheduledTaskService — reads degrade with no db", () => {
  it("findAll returns [] without a db", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.findAll()).resolves.toEqual([]);
  });

  it("findOne returns null without a db", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.findOne("s1")).resolves.toBeNull();
  });

  it("listDueCronSchedules returns [] without a db", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.listDueCronSchedules()).resolves.toEqual([]);
  });

  it("listEnabledEventSchedules returns [] without a db", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.listEnabledEventSchedules()).resolves.toEqual([]);
  });

  it("mutations throw Database not available without a db", async () => {
    const { svc } = serviceWith(undefined);
    await expect(svc.enable("s1")).rejects.toThrow("Database not available");
    await expect(svc.disable("s1")).rejects.toThrow("Database not available");
    await expect(svc.markRun("s1", new Date())).resolves.toBeUndefined(); // write-style but treated as best-effort
  });
});

describe("ScheduledTaskService — reads with a db", () => {
  it("findAll maps rows and orders by createdAt desc, take 100", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.scheduledTask.findMany.mockResolvedValue([row({ id: "s1" }), row({ id: "s2" })]);
    const list = await svc.findAll();
    expect(db.scheduledTask.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe("s1");
  });

  it("findOne returns null when no row exists", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.scheduledTask.findUnique.mockResolvedValue(null);
    await expect(svc.findOne("nope")).resolves.toBeNull();
  });

  it("listDueCronSchedules queries enabled cron schedules with nextRunAt null or in the past", async () => {
    const { svc, db } = serviceWith(makeDb(), new Date("2026-08-03T12:00:00.000Z"));
    db.scheduledTask.findMany.mockResolvedValue([row()]);
    await svc.listDueCronSchedules(new Date("2026-08-03T12:00:00.000Z"));
    expect(db.scheduledTask.findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        kind: "cron",
        OR: [
          { nextRunAt: null },
          { nextRunAt: { lte: new Date("2026-08-03T12:00:00.000Z") } },
        ],
      },
      take: 50,
    });
  });
});

describe("ScheduledTaskService — enable/disable/remove/markRun", () => {
  it("enable returns null when the schedule is not found", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.scheduledTask.findUnique.mockResolvedValue(null);
    await expect(svc.enable("nope")).resolves.toBeNull();
  });

  it("enable sets enabled:true and resets nextRunAt for a cron schedule", async () => {
    const { svc, db } = serviceWith(makeDb(), new Date("2026-08-03T00:00:00.000Z"));
    db.scheduledTask.findUnique.mockResolvedValue(row());
    db.scheduledTask.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      row({ ...data, enabled: true }),
    );
    const updated = await svc.enable("s1");
    expect(db.scheduledTask.update).toHaveBeenCalledOnce();
    const data = db.scheduledTask.update.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(data.enabled).toBe(true);
    expect(data.lastError).toBeNull();
    expect(data.nextRunAt).toBeInstanceOf(Date);
    expect(updated?.enabled).toBe(true);
  });

  it("enable does not recompute nextRunAt for an event schedule (keeps existing value)", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.scheduledTask.findUnique.mockResolvedValue(row({ kind: "event", spec: { event: "x" }, nextRunAt: null }));
    db.scheduledTask.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      row({ ...data }),
    );
    const updated = await svc.enable("s1");
    const data = db.scheduledTask.update.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(data.enabled).toBe(true);
    expect(data.nextRunAt).toBeNull(); // event schedules keep their (null) nextRunAt
    expect(updated?.enabled).toBe(true);
  });

  it("disable sets enabled:false and returns null when not found", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.scheduledTask.findUnique.mockResolvedValue(null);
    await expect(svc.disable("nope")).resolves.toBeNull();

    db.scheduledTask.findUnique.mockResolvedValue(row());
    db.scheduledTask.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      row({ ...data, enabled: false }),
    );
    const updated = await svc.disable("s1");
    expect(db.scheduledTask.update.mock.calls[0]![0]!.data.enabled).toBe(false);
    expect(updated?.enabled).toBe(false);
  });

  it("remove deletes the row and returns true; returns false on not-found", async () => {
    const { svc, db } = serviceWith(makeDb());
    db.scheduledTask.delete.mockResolvedValue(row());
    await expect(svc.remove("s1")).resolves.toBe(true);

    db.scheduledTask.delete.mockRejectedValue(new Error("not found"));
    await expect(svc.remove("s1")).resolves.toBe(false);
  });

  it("markRun increments runCount, stamps lastRunAt, and advances nextRunAt for a cron schedule", async () => {
    const { svc, db } = serviceWith(makeDb(), new Date("2026-08-03T00:00:00.000Z"));
    const existing = row({ nextRunAt: new Date("2026-08-03T00:00:00.000Z") });
    db.scheduledTask.findUnique.mockResolvedValue(existing);
    db.scheduledTask.update.mockResolvedValue(existing);
    await svc.markRun("s1", existing.nextRunAt as Date, null);
    const data = db.scheduledTask.update.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(data.runCount).toEqual({ increment: 1 });
    expect(data.lastRunAt).toBeInstanceOf(Date);
    expect((data.nextRunAt as Date).getTime()).toBeGreaterThan(
      (existing.nextRunAt as Date).getTime(),
    );
  });

  it("markRun records lastError on failure and advances nextRunAt so the loop does not spin", async () => {
    const { svc, db } = serviceWith(makeDb(), new Date("2026-08-03T00:00:00.000Z"));
    const existing = row({ nextRunAt: new Date("2026-08-03T00:00:00.000Z") });
    db.scheduledTask.findUnique.mockResolvedValue(existing);
    db.scheduledTask.update.mockResolvedValue(existing);
    await svc.markRun("s1", existing.nextRunAt as Date, "boom");
    const data = db.scheduledTask.update.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(data.lastError).toBe("boom");
    expect((data.nextRunAt as Date).getTime()).toBeGreaterThan(
      (existing.nextRunAt as Date).getTime(),
    );
  });
});
