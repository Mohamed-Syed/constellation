import { describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { NotificationService } from "./notification.service.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { EventBusService } from "../events/event-bus.service.js";

const NOW = new Date("2026-08-04T10:00:00.000Z");

function fullRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    kind: "engine.task.failed",
    severity: "error",
    title: "Task failed",
    message: "boom",
    refType: "task",
    refId: "t1",
    read: false,
    createdAt: NOW,
    ...overrides,
  };
}

/** Minimal Prisma delegate mock — the `db` shape NotificationService touches. */
function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    notification: {
      create: vi.fn(async () => fullRow()),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => fullRow({ read: true })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      delete: vi.fn(async () => fullRow()),
      ...overrides,
    },
  };
}

/** Fake EventBus whose per-plugin `on` registrations are captured for driving. */
function makeBus() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const bus = {
    forPlugin: () => ({
      on: (topic: string, cb: (payload: unknown) => void) => {
        handlers.set(topic, cb);
      },
      emit: vi.fn(),
      onPlatform: vi.fn(),
    }),
  } as unknown as EventBusService;
  return { bus, handlers };
}

function svcWith(db: Record<string, unknown>, bus?: EventBusService): NotificationService {
  return new NotificationService({ db } as unknown as PrismaService, bus);
}

describe("NotificationService — record", () => {
  it("persists the notification with read=false and the given mapping", async () => {
    const db = makeDb();
    const svc = svcWith(db);
    await svc.record("engine.task.failed", "error", "Task failed", "boom", "task", "t1");
    expect(db.notification.create).toHaveBeenCalledWith({
      data: {
        kind: "engine.task.failed",
        severity: "error",
        title: "Task failed",
        message: "boom",
        refType: "task",
        refId: "t1",
        read: false,
      },
    });
  });

  it("defaults message/ref fields and clamps over-long text", async () => {
    const db = makeDb();
    const svc = svcWith(db);
    const long = "x".repeat(2000);
    await svc.record("scheduler.schedule.fired", "info", long, null, null, null);
    const data = (db.notification.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.message).toBeNull();
    expect(data.refType).toBeNull();
    expect(data.refId).toBeNull();
    expect(String(data.title).length).toBe(501); // 500 chars + ellipsis
    expect(String(data.title).endsWith("…")).toBe(true);
  });

  it("never throws and warns once when there is no database", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const svc = new NotificationService({ db: undefined } as unknown as PrismaService);
    await expect(svc.record("engine.task.failed", "error", "Task failed", "boom", "task", "t1")).resolves.toBeUndefined();
    await expect(svc.record("engine.task.failed", "error", "Task failed", "boom", "task", "t2")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("NotificationService — list / unreadCount", () => {
  it("returns items newest-first plus the total unread count", async () => {
    const db = makeDb({
      findMany: vi.fn(async () => [fullRow(), fullRow({ id: "n2", read: true })]),
      count: vi.fn(async () => 1),
    });
    const svc = svcWith(db);
    const result = await svc.list(25);
    expect(db.notification.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    expect(db.notification.count).toHaveBeenCalledWith({ where: { read: false } });
    expect(result.unreadCount).toBe(1);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ id: "n1", createdAt: NOW.toISOString() });
  });

  it("applies kind and unread filters and clamps the limit to [1, 100]", async () => {
    const db = makeDb();
    const svc = svcWith(db);
    await svc.list(500, "engine.task.failed", true);
    expect(db.notification.findMany).toHaveBeenCalledWith({
      where: { kind: "engine.task.failed", read: false },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    await svc.list(0);
    expect(db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 }),
    );
  });

  it("degrades to an empty feed without a database", async () => {
    const svc = new NotificationService({ db: undefined } as unknown as PrismaService);
    await expect(svc.list()).resolves.toEqual({ items: [], unreadCount: 0 });
    await expect(svc.unreadCount()).resolves.toBe(0);
  });

  it("returns 0 when the count query fails", async () => {
    const db = makeDb({ count: vi.fn(async () => { throw new Error("db down"); }) });
    const svc = svcWith(db);
    await expect(svc.unreadCount()).resolves.toBe(0);
  });
});

describe("NotificationService — markRead / markAllRead / dismiss", () => {
  it("marks one notification read and returns it", async () => {
    const db = makeDb({ findUnique: vi.fn(async () => fullRow()) });
    const svc = svcWith(db);
    const result = await svc.markRead("n1");
    expect(db.notification.update).toHaveBeenCalledWith({ where: { id: "n1" }, data: { read: true } });
    expect(result).toMatchObject({ id: "n1", read: true });
  });

  it("resolves null for a missing notification (no update)", async () => {
    const db = makeDb();
    const svc = svcWith(db);
    await expect(svc.markRead("missing")).resolves.toBeNull();
    expect(db.notification.update).not.toHaveBeenCalled();
  });

  it("marks all unread read and resolves the flipped count", async () => {
    const db = makeDb({ updateMany: vi.fn(async () => ({ count: 3 })) });
    const svc = svcWith(db);
    await expect(svc.markAllRead()).resolves.toBe(3);
    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { read: false },
      data: { read: true },
    });
  });

  it("dismisses (deletes) one notification and resolves the row", async () => {
    const db = makeDb({ findUnique: vi.fn(async () => fullRow()) });
    const svc = svcWith(db);
    const result = await svc.dismiss("n1");
    expect(db.notification.delete).toHaveBeenCalledWith({ where: { id: "n1" } });
    expect(result).toMatchObject({ id: "n1" });
  });

  it("resolves null for a missing dismiss target", async () => {
    const db = makeDb();
    const svc = svcWith(db);
    await expect(svc.dismiss("missing")).resolves.toBeNull();
    expect(db.notification.delete).not.toHaveBeenCalled();
  });
});

describe("NotificationService — EventBus wiring", () => {
  it("registers one listener per source topic on module init", () => {
    const { bus, handlers } = makeBus();
    const svc = new NotificationService({ db: undefined } as unknown as PrismaService, bus);
    svc.onModuleInit();
    expect(handlers.size).toBe(NotificationService.SOURCE_TOPICS.length);
    for (const topic of NotificationService.SOURCE_TOPICS) expect(handlers.has(topic)).toBe(true);
  });

  it("maps engine.task.failed onto an error notification for the task", async () => {
    const { bus, handlers } = makeBus();
    const db = makeDb();
    const svc = svcWith(db, bus);
    svc.onModuleInit();
    await handlers.get("engine.task.failed")!({ taskId: "t1", detail: "boom", at: NOW.toISOString(), classification: "terminal" });
    expect(db.notification.create).toHaveBeenCalledWith({
      data: {
        kind: "engine.task.failed",
        severity: "error",
        title: "Task failed",
        message: "boom",
        refType: "task",
        refId: "t1",
        read: false,
      },
    });
  });

  it("maps engine.task.stale onto a warning with the stale duration", async () => {
    const { bus, handlers } = makeBus();
    const db = makeDb();
    const svc = svcWith(db, bus);
    svc.onModuleInit();
    await handlers.get("engine.task.stale")!({ taskId: "t2", detail: "12345ms", at: NOW.toISOString(), staleMs: 12345 });
    const data = (db.notification.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ kind: "engine.task.stale", severity: "warning", title: "Task flagged stale", refType: "task", refId: "t2" });
    expect(String(data.message)).toContain("12345ms");
  });

  it("maps engine.task.recovered onto a success notification", async () => {
    const { bus, handlers } = makeBus();
    const db = makeDb();
    const svc = svcWith(db, bus);
    svc.onModuleInit();
    await handlers.get("engine.task.recovered")!({ taskId: "t3", detail: null, at: NOW.toISOString() });
    const data = (db.notification.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ kind: "engine.task.recovered", severity: "success", title: "Task recovered", refType: "task", refId: "t3" });
  });

  it("maps scheduler.schedule.fired onto an info notification naming the schedule", async () => {
    const { bus, handlers } = makeBus();
    const db = makeDb();
    const svc = svcWith(db, bus);
    svc.onModuleInit();
    await handlers.get("scheduler.schedule.fired")!({ scheduleId: "s1", name: "Digest", taskId: "t4" });
    const data = (db.notification.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      kind: "scheduler.schedule.fired",
      severity: "info",
      title: "Schedule fired",
      message: "Digest → task t4",
      refType: "schedule",
      refId: "s1",
    });
  });

  it("maps scheduler.schedule.error onto an error notification with the failure text", async () => {
    const { bus, handlers } = makeBus();
    const db = makeDb();
    const svc = svcWith(db, bus);
    svc.onModuleInit();
    await handlers.get("scheduler.schedule.error")!({ scheduleId: "s2", name: "Nightly", error: "redis down" });
    const data = (db.notification.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      kind: "scheduler.schedule.error",
      severity: "error",
      title: "Schedule run failed",
      message: "Nightly: redis down",
      refType: "schedule",
      refId: "s2",
    });
  });

  it("ignores unknown topics and survives a missing bus", async () => {
    const { bus, handlers } = makeBus();
    const db = makeDb();
    const svc = svcWith(db, bus);
    svc.onModuleInit();
    await handlers.get("some.unknown.topic")?.({});
    expect(db.notification.create).not.toHaveBeenCalled();

    const noBus = new NotificationService({ db } as unknown as PrismaService, undefined);
    expect(() => noBus.onModuleInit()).not.toThrow();
  });

  it("maps engine.task.completed onto a success notification", async () => {
    const { bus, handlers } = makeBus();
    const db = makeDb();
    const svc = svcWith(db, bus);
    svc.onModuleInit();
    await handlers.get("engine.task.completed")!({ taskId: "t9", detail: null, at: NOW.toISOString() });
    const data = (db.notification.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ kind: "engine.task.completed", severity: "success", title: "Task completed", refType: "task", refId: "t9" });
  });

  it("maps engine.task.paused onto a needs-approval warning", async () => {
    const { bus, handlers } = makeBus();
    const db = makeDb();
    const svc = svcWith(db, bus);
    svc.onModuleInit();
    await handlers.get("engine.task.paused")!({ taskId: "t10", detail: "awaiting approval", at: NOW.toISOString() });
    const data = (db.notification.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ kind: "engine.task.paused", severity: "warning", title: "Task needs approval", refType: "task", refId: "t10" });
  });

  it("dispatches every persisted event to the configured channels (fire-and-forget)", async () => {
    const { bus, handlers } = makeBus();
    const db = makeDb();
    const channels = { dispatch: vi.fn(async () => undefined) };
    const svc = new NotificationService(
      { db } as unknown as PrismaService,
      bus,
      channels as unknown as never,
    );
    svc.onModuleInit();
    await handlers.get("engine.task.failed")!({ taskId: "t1", detail: "boom", at: NOW.toISOString(), classification: "terminal" });
    expect(channels.dispatch).toHaveBeenCalledWith("engine.task.failed", {
      kind: "engine.task.failed",
      severity: "error",
      title: "Task failed",
      message: "boom",
      refType: "task",
      refId: "t1",
    });
    expect(db.notification.create).toHaveBeenCalled();
  });

  it("a throwing channel dispatch never breaks persistence", async () => {
    const { bus, handlers } = makeBus();
    const db = makeDb();
    const channels = {
      dispatch: vi.fn(async () => {
        throw new Error("webhook down");
      }),
    };
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const svc = new NotificationService({ db } as unknown as PrismaService, bus, channels as unknown as never);
    svc.onModuleInit();
    await expect(handlers.get("engine.task.completed")!({ taskId: "t9", detail: null, at: NOW.toISOString() })).resolves.toBeUndefined();
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
