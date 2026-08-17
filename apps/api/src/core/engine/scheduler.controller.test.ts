import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { SchedulerController } from "./scheduler.controller.js";
import { CronParseError } from "./cron.js";
import type { CreateScheduleDto } from "./dto/scheduler.dto.js";

/**
 * SchedulerController tests (Engine v0.4). Hand-wired with `new`, no Nest DI.
 * Collaborators (ScheduledTaskService, SchedulerEngineService, AuditService)
 * are `vi.fn()` fakes. Contract under test:
 *  1. POST /schedules creates a schedule, audits it, notifies the scheduler to
 *     re-register event listeners, and maps CronParseError -> 400.
 *  2. GET routes list/fetch; 404 on a missing schedule.
 *  3. enable/disable/delete audit + notify the scheduler; 404 when not found.
 */

function makeSchedulesStub(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn(
      async (dto: CreateScheduleDto, actorId: string | null = null) => ({
        id: "s1",
        name: dto.name,
        kind: dto.kind,
        spec: dto.kind === "cron" ? { cron: dto.cron } : { event: dto.event },
        enabled: dto.enabled ?? true,
        title: dto.task.title,
        prompt: dto.task.prompt,
        model: dto.task.model ?? null,
        maxSteps: dto.task.maxSteps ?? 20,
        maxTokens: dto.task.maxTokens ?? null,
        nextRunAt: null,
        lastRunAt: null,
        runCount: 0,
        lastError: null,
        workflowId: null,
        teamId: dto.teamId ?? null,
        createdBy: actorId,
      }),
    ),
    findOne: vi.fn(async () => ({ id: "s1", teamId: null, createdBy: null })),
    findAll: vi.fn(async () => []),
    enable: vi.fn(async () => ({ id: "s1", enabled: true })),
    disable: vi.fn(async () => ({ id: "s1", enabled: false })),
    remove: vi.fn(async () => true),
    ...overrides,
  };
}

function makeSchedulerStub() {
  return { refreshEventListeners: vi.fn(async () => 0) };
}

function makeAuditStub() {
  return { record: vi.fn(async () => undefined) };
}

function makeTeamsStub(overrides: Record<string, unknown> = {}) {
  return {
    listForUser: vi.fn(async () => []),
    isMember: vi.fn(async () => false),
    ...overrides,
  };
}

function makeController(
  schedules = makeSchedulesStub(),
  scheduler = makeSchedulerStub(),
  audit = makeAuditStub(),
  teams = makeTeamsStub(),
) {
  const controller = new SchedulerController(
    schedules as never,
    scheduler as never,
    audit as never,
    teams as never,
  );
  return { controller, schedules, scheduler, audit, teams };
}

const user: AuthPrincipal = { id: "user-1", email: "a@b.c", roles: ["admin"], permissions: ["platform:admin"] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SchedulerController — createSchedule", () => {
  it("creates a schedule, audits it, and refreshes event listeners", async () => {
    const { controller, schedules, scheduler, audit } = makeController();
    const dto = {
      name: "daily",
      kind: "cron",
      cron: "* * * * *",
      task: { title: "Digest", prompt: "Summarize." },
    } as CreateScheduleDto;

    const created = await controller.createSchedule(dto, user);

    expect(schedules.create).toHaveBeenCalledWith(dto, "user-1");
    expect(audit.record).toHaveBeenCalledWith("user-1", "engine.schedule.created", "s1", {
      name: "daily",
      kind: "cron",
      actor: "a@b.c",
    });
    expect(scheduler.refreshEventListeners).toHaveBeenCalledOnce();
    expect(created.id).toBe("s1");
  });

  it("maps a CronParseError from the service to a 400", async () => {
    const schedules = makeSchedulesStub();
    (schedules.create as ReturnType<typeof vi.fn>).mockRejectedValue(new CronParseError("bad cron"));
    const { controller } = makeController(schedules);

    await expect(
      controller.createSchedule({} as CreateScheduleDto, user),
    ).rejects.toThrow(BadRequestException);
  });

  it("allows a non-admin to create a schedule under a team they belong to", async () => {
    const schedules = makeSchedulesStub();
    const teams = makeTeamsStub({ isMember: vi.fn(async () => true) });
    const { controller } = makeController(schedules, makeSchedulerStub(), makeAuditStub(), teams);
    const dto = {
      name: "team-daily",
      kind: "cron",
      cron: "0 9 * * *",
      teamId: "team-1",
      task: { title: "T", prompt: "P" },
    } as CreateScheduleDto;
    const nonAdmin: AuthPrincipal = { id: "u2", email: "u@c.c", roles: [], permissions: [] };

    await controller.createSchedule(dto, nonAdmin);

    expect(schedules.create).toHaveBeenCalledWith(dto, "u2");
  });

  it("forbids a non-admin creating a team-global schedule (no teamId)", async () => {
    const { controller } = makeController();
    const nonAdmin: AuthPrincipal = { id: "u2", email: "u@c.c", roles: [], permissions: [] };
    await expect(
      controller.createSchedule({ name: "global", kind: "cron", cron: "0 0 * * *", task: { title: "T", prompt: "P" } } as CreateScheduleDto, nonAdmin),
    ).rejects.toThrow(ForbiddenException);
  });

  it("forbids creating a schedule under a team the caller is not a member of", async () => {
    const { controller } = makeController(); // teams.isMember -> false
    const nonAdmin: AuthPrincipal = { id: "u2", email: "u@c.c", roles: [], permissions: [] };
    await expect(
      controller.createSchedule({ name: "x", kind: "cron", cron: "0 0 * * *", teamId: "team-9", task: { title: "T", prompt: "P" } } as CreateScheduleDto, nonAdmin),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rethrows non-cron errors unchanged", async () => {
    const schedules = makeSchedulesStub();
    (schedules.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Database not available"));
    const { controller } = makeController(schedules);

    await expect(controller.createSchedule({} as CreateScheduleDto, user)).rejects.toThrow(
      /Database not available/,
    );
  });
});

describe("SchedulerController — reads", () => {
  it("lists schedules", async () => {
    const { controller, schedules } = makeController();
    await controller.listSchedules();
    expect(schedules.findAll).toHaveBeenCalledOnce();
  });

  it("returns a schedule found by id", async () => {
    const schedules = makeSchedulesStub({ findOne: vi.fn(async () => ({ id: "s1", teamId: null, createdBy: null })) });
    const { controller } = makeController(schedules);
    await expect(controller.getSchedule("s1", user)).resolves.toEqual({ id: "s1", teamId: null, createdBy: null });
  });

  it("throws 404 when a schedule is not found", async () => {
    const schedules = makeSchedulesStub({ findOne: vi.fn(async () => null) });
    const { controller } = makeController(schedules);
    await expect(controller.getSchedule("nope", user)).rejects.toThrow(NotFoundException);
  });
});

describe("SchedulerController — enable / disable / delete", () => {
  it("enables a schedule, audits, and refreshes listeners", async () => {
    const { controller, schedules, scheduler, audit } = makeController();
    await controller.enableSchedule("s1", user);
    expect(schedules.enable).toHaveBeenCalledWith("s1");
    expect(audit.record).toHaveBeenCalledWith("user-1", "engine.schedule.enabled", "s1", {
      actor: "a@b.c",
    });
    expect(scheduler.refreshEventListeners).toHaveBeenCalledOnce();
  });

  it("throws 404 when enabling a missing schedule", async () => {
    const schedules = makeSchedulesStub({ findOne: vi.fn(async () => null), enable: vi.fn(async () => null) });
    const { controller } = makeController(schedules);
    await expect(controller.enableSchedule("nope", user)).rejects.toThrow(NotFoundException);
  });

  it("disables a schedule and audits", async () => {
    const { controller, schedules, scheduler, audit } = makeController();
    await controller.disableSchedule("s1", user);
    expect(schedules.disable).toHaveBeenCalledWith("s1");
    expect(audit.record).toHaveBeenCalledWith("user-1", "engine.schedule.disabled", "s1", {
      actor: "a@b.c",
    });
    // Disable intentionally does NOT refresh listeners: the event-handler
    // re-fetches the schedule from the DB on each fire, so a disabled schedule
    // naturally stops firing (no stale listener to unregister).
    expect(scheduler.refreshEventListeners).not.toHaveBeenCalled();
  });

  it("throws 404 when disabling a missing schedule", async () => {
    const schedules = makeSchedulesStub({ findOne: vi.fn(async () => null), disable: vi.fn(async () => null) });
    const { controller } = makeController(schedules);
    await expect(controller.disableSchedule("nope", user)).rejects.toThrow(NotFoundException);
  });

  it("deletes a schedule and audits", async () => {
    const { controller, schedules, scheduler, audit } = makeController();
    await expect(controller.deleteSchedule("s1", user)).resolves.toEqual({ id: "s1", deleted: true });
    // Same as disable: deleting does not refresh listeners (the handler
    // re-fetches from DB, so a deleted schedule stops firing naturally).
    expect(scheduler.refreshEventListeners).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith("user-1", "engine.schedule.deleted", "s1", {
      actor: "a@b.c",
    });
  });

  it("throws 404 when deleting a missing schedule", async () => {
    const schedules = makeSchedulesStub({ findOne: vi.fn(async () => null), remove: vi.fn(async () => false) });
    const { controller } = makeController(schedules);
    await expect(controller.deleteSchedule("nope", user)).rejects.toThrow(NotFoundException);
  });
});
