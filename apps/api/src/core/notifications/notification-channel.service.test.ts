import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { buildEnvelope, NotificationChannelService } from "./notification-channel.service.js";
import type { PrismaService } from "../database/prisma.service.js";

const PAYLOAD = {
  kind: "engine.task.failed",
  severity: "error",
  title: "Task failed",
  message: "boom",
  refType: "task",
  refId: "t1",
};

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    setting: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
      ...overrides,
    },
  };
}

function svcWith(db: Record<string, unknown>, sender?: unknown): NotificationChannelService {
  return new NotificationChannelService({ db } as unknown as PrismaService, sender as never);
}

describe("buildEnvelope — webhook dialect mapping", () => {
  it("slack → { text }", () => {
    expect(buildEnvelope("slack", PAYLOAD)).toEqual({ text: "Task failed — boom" });
  });

  it("discord → { content }", () => {
    expect(buildEnvelope("discord", PAYLOAD)).toEqual({ content: "Task failed — boom" });
  });

  it("teams → legacy MessageCard with facts", () => {
    const env = buildEnvelope("teams", PAYLOAD) as Record<string, unknown>;
    expect(env["@type"]).toBe("MessageCard");
    expect(env["@context"]).toBe("http://schema.org/extensions");
    expect(env.title).toBe("Task failed");
    expect((env.sections as Array<{ facts: unknown[] }>)[0].facts).toContainEqual({ name: "Kind", value: "engine.task.failed" });
    expect((env.sections as Array<{ facts: unknown[] }>)[0].facts).toContainEqual({ name: "task", value: "t1" });
  });

  it("generic → full structured payload", () => {
    expect(buildEnvelope("generic", PAYLOAD)).toEqual(PAYLOAD);
  });

  it("omits the message when null", () => {
    const env = buildEnvelope("slack", { ...PAYLOAD, message: null });
    expect(env).toEqual({ text: "Task failed" });
  });
});

describe("NotificationChannelService — CRUD + delivery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists [] with no database and warns once", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const svc = new NotificationChannelService({ db: undefined } as unknown as PrismaService);
    await expect(svc.list()).resolves.toEqual([]);
    await expect(svc.list()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("upsert creates and updates channels under the core settings key", async () => {
    const db = makeDb();
    const svc = svcWith(db);
    const created = await svc.upsert({
      name: "ops-slack",
      url: "https://hooks.slack.com/services/AAA/BBB/CCC",
      format: "slack",
      kinds: ["engine.task.failed"],
    });
    expect(created).toMatchObject({ type: "webhook", format: "slack", kinds: ["engine.task.failed"], enabled: true });
    expect(db.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pluginId_key: { pluginId: "core", key: "notification.channels" } },
        create: expect.objectContaining({ key: "notification.channels" }),
      }),
    );
    // update by id
    db.setting.findUnique.mockResolvedValue({ value: [created] });
    const updated = await svc.upsert({ id: created.id, name: "ops-slack-v2", url: "https://x", format: "generic" });
    expect(updated).toMatchObject({ id: created.id, name: "ops-slack-v2", format: "generic" });
  });

  it("remove deletes an existing channel; false for unknown", async () => {
    const db = makeDb();
    const svc = svcWith(db);
    const ch = await svc.upsert({ name: "a", url: "https://example.com/hook" });
    db.setting.findUnique.mockResolvedValue({ value: [ch] });
    await expect(svc.remove(ch.id)).resolves.toBe(true);
    await expect(svc.remove("missing")).resolves.toBe(false);
  });

  it("dispatch POSTs only matching ENABLED channels with the right envelope", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const db = makeDb();
    const svc = svcWith(db);
    const all = await svc.upsert({ name: "all-events", url: "http://localhost:9080/all", format: "generic" });
    const failedOnly = await svc.upsert({
      name: "failures",
      url: "http://localhost:9080/fail",
      format: "generic",
      kinds: ["engine.task.failed"],
    });
    const disabled = await svc.upsert({ name: "off", url: "http://localhost:9080/off", format: "generic", enabled: false });
    db.setting.findUnique.mockResolvedValue({ value: [all, failedOnly, disabled] });

    await svc.dispatch("engine.task.completed", { ...PAYLOAD, kind: "engine.task.completed", title: "Task completed" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // only all-events (failures filters, off is disabled)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:9080/all");
    expect(JSON.parse(String(init.body))).toMatchObject({ kind: "engine.task.completed", title: "Task completed" });

    fetchMock.mockClear();
    await svc.dispatch("engine.task.failed", PAYLOAD);
    expect(fetchMock).toHaveBeenCalledTimes(2); // all-events + failures
  });

  it("dispatch never throws on a failing webhook (fire-and-forget)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    const db = makeDb();
    const svc = svcWith(db);
    const ch = await svc.upsert({ name: "dead", url: "http://localhost:9080/dead", format: "generic" });
    db.setting.findUnique.mockResolvedValue({ value: [ch] });
    await expect(svc.dispatch("engine.task.failed", PAYLOAD)).resolves.toBeUndefined();
  });

  it("sendTest posts a test payload and reports the outcome", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const db = makeDb();
    const svc = svcWith(db);
    const ch = await svc.upsert({ name: "test", url: "http://localhost:9080/test", format: "generic" });
    const result = await svc.sendTest(ch);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("NotificationChannelService — SMTP channels (3.5 remainder)", () => {
  const OLD = { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, from: process.env.SMTP_FROM };
  afterEach(() => {
    process.env.SMTP_HOST = OLD.host;
    process.env.SMTP_PORT = OLD.port;
    process.env.SMTP_FROM = OLD.from;
  });

  it("persists an smtp channel; sendTest delivers through the injected sender", async () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "9025";
    process.env.SMTP_FROM = "constellation@localhost";
    const sender = vi.fn(async () => ({ ok: true }));
    const db = makeDb();
    const svc = svcWith(db, sender);
    const ch = await svc.upsert({ name: "mail-ops", type: "smtp", to: "ops@corp.com", from: "constellation@corp.com", kinds: [] });
    expect(ch?.type).toBe("smtp");
    expect(ch?.to).toBe("ops@corp.com");
    expect(sender).not.toHaveBeenCalled();
    await svc.sendTest(ch);
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1",
        port: 9025,
        from: "constellation@corp.com",
        to: "ops@corp.com",
        subject: expect.stringContaining("Constellation"),
        text: expect.stringContaining("wired up correctly"),
      }),
    );
  });

  it("refuses an smtp channel without a recipient", async () => {
    const db = makeDb();
    const svc = svcWith(db);
    await expect(svc.upsert({ name: "bad", type: "smtp", kinds: [] })).resolves.toBeNull();
  });

  it("delivers real events to an smtp channel through the sender; kinds filter applies", async () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "9025";
    const sender = vi.fn(async () => ({ ok: true }));
    const db = makeDb();
    const svc = svcWith(db, sender);
    const ch = await svc.upsert({ name: "mail-ops", type: "smtp", to: "ops@corp.com", kinds: ["engine.task.failed"] });
    db.setting.findUnique.mockResolvedValue({ value: [ch] });
    await svc.dispatch("engine.task.completed", PAYLOAD); // kind mismatch -> no mail
    expect(sender).not.toHaveBeenCalled();
    await svc.dispatch("engine.task.failed", PAYLOAD);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]?.[0]).toMatchObject({ to: "ops@corp.com", subject: expect.stringContaining("Task failed"), text: expect.stringContaining("Kind: engine.task.failed") });
  });

  it("degrades honestly when SMTP_HOST is unset (channel still persists, sendTest reports the error)", async () => {
    delete process.env.SMTP_HOST;
    const db = makeDb();
    const svc = svcWith(db);
    const ch = await svc.upsert({ name: "mail-ops", type: "smtp", to: "ops@corp.com", kinds: [] });
    expect(ch?.type).toBe("smtp");
    const result = await svc.sendTest(ch);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SMTP_HOST");
  });

  it("never throws when the sender fails (fire-and-forget)", async () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "9025";
    const sender = vi.fn(async () => ({ ok: false, error: "relay refused" }));
    const db = makeDb();
    const svc = svcWith(db, sender);
    const ch = await svc.upsert({ name: "mail-ops", type: "smtp", to: "ops@corp.com", kinds: [] });
    db.setting.findUnique.mockResolvedValue({ value: [ch] });
    await expect(svc.dispatch("engine.task.failed", PAYLOAD)).resolves.toBeUndefined();
  });
});
