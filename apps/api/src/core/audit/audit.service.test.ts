import { describe, expect, it, vi } from "vitest";
import { AuditService, auditToCsv, type AuditEntry } from "./audit.service.js";
import type { PrismaService } from "../database/prisma.service.js";

const ROW = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  id: "a1",
  pluginId: "core",
  actorId: "user-1",
  action: "workflow.run",
  metadata: { workflowId: "wf1" },
  createdAt: new Date("2026-08-05T00:00:00Z"),
  ...overrides,
});

describe("auditToCsv — compliance export", () => {
  it("emits the header + one row per entry with RFC-4180 quoting", () => {
    const csv = auditToCsv([
      ROW({ metadata: { ok: true } }),
      ROW({ metadata: "a,b" }),
      ROW({ actorId: null, action: "auth.login", metadata: null }),
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("createdAt,actorId,action,metadata");
    expect(lines[1]).toBe('2026-08-05T00:00:00.000Z,user-1,workflow.run,"{""ok"":true}"');
    expect(lines[2]).toBe('2026-08-05T00:00:00.000Z,user-1,workflow.run,"""a,b"""');
    expect(lines[3]).toBe("2026-08-05T00:00:00.000Z,,auth.login,");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("AuditService — listForExport", () => {
  it("passes actor/action filters + a bounded take to Prisma", async () => {
    const db = {
      auditLog: { findMany: vi.fn(async () => []) },
    };
    const svc = new AuditService({ db } as unknown as PrismaService);
    await svc.listForExport({ actor: "user", action: "workflow", limit: 500 });
    expect(db.auditLog.findMany).toHaveBeenCalledWith({
      where: { actorId: { contains: "user" }, action: { contains: "workflow" } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  });

  it("caps the take at 1000 and degrades to [] without a db", async () => {
    const db = { auditLog: { findMany: vi.fn(async () => []) } };
    const svc = new AuditService({ db } as unknown as PrismaService);
    await svc.listForExport({ limit: 5000 });
    expect(db.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1000, where: {} }),
    );
    const noDb = new AuditService({ db: undefined } as unknown as PrismaService);
    await expect(noDb.listForExport()).resolves.toEqual([]);
  });
});
