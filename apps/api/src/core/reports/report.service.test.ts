import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReportService } from "./report.service.js";

describe("ReportService — scheduled report delivery (Phase 4.0 backlog #2)", () => {
  const dir = join(tmpdir(), `constellation-reports-test-${Date.now()}`);
  const audit = {
    listForExport: vi.fn(),
  } as never;
  const notifications = { record: vi.fn() } as never;
  const channels = { dispatch: vi.fn() } as never;

  beforeEach(async () => {
    await mkdir(dir, { recursive: true });
    (audit as unknown as { listForExport: ReturnType<typeof vi.fn> }).listForExport.mockResolvedValue([
      { id: "a", pluginId: "core", actorId: "u1", action: "auth.login", metadata: {}, createdAt: new Date("2026-08-05T01:00:00Z") },
      { id: "b", pluginId: "core", actorId: "u1", action: "engine.task.complete", metadata: {}, createdAt: new Date("2026-08-05T02:00:00Z") },
    ]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function svc() {
    return new ReportService(
      audit as never,
      notifications as never,
      channels as never,
      undefined,
      { reportDir: dir, maxRows: 500 },
    );
  }

  it("generates a valid PDF report + records a durable notification + dispatches a channel event", async () => {
    const report = await svc().generate({ deliver: true, title: "Compliance" });
    expect(report.bytes).toBeGreaterThan(200);
    expect(report.rows).toBe(2);
    expect(report.filename).toMatch(/^audit-report-.*\.pdf$/);
    expect((notifications as unknown as { record: ReturnType<typeof vi.fn> }).record).toHaveBeenCalledWith(
      "report.generated",
      "info",
      "Compliance",
      expect.stringContaining("2 audit row"),
      "report",
      report.filename,
      null,
    );
    expect((channels as unknown as { dispatch: ReturnType<typeof vi.fn> }).dispatch).toHaveBeenCalledWith(
      "report.generated",
      expect.objectContaining({ kind: "report.generated", title: "Compliance" }),
    );
    // The PDF is actually written and is a valid PDF header.
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(report.path);
    expect(bytes.slice(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("targets the notification to one user when a recipientId is set", async () => {
    const report = await svc().generate({ deliver: true, recipientId: "user-7" });
    expect((notifications as unknown as { record: ReturnType<typeof vi.fn> }).record).toHaveBeenCalledWith(
      "report.generated",
      "info",
      "Constellation compliance report",
      expect.stringContaining("audit row"),
      "report",
      report.filename,
      "user-7",
    );
  });

  it("degrades: an empty audit log still produces a report and does not throw on deliver failure", async () => {
    (audit as unknown as { listForExport: { mockResolvedValue: (v: unknown) => void } }).listForExport.mockResolvedValue([]);
    (channels as unknown as { dispatch: { mockRejectedValue: (e: Error) => void } }).dispatch.mockRejectedValue(new Error("webhook down"));
    const report = await svc().generate({ deliver: true });
    expect(report.rows).toBe(0);
    expect(report.bytes).toBeGreaterThan(200);
  });

  it("lists generated reports newest-first", async () => {
    const a = await svc().generate({ deliver: false, title: "one" });
    const b = await svc().generate({ deliver: false, title: "two" });
    const items = await svc().list();
    expect(items[0]?.filename).toBe(b.filename);
    expect(items.some((i) => i.filename === a.filename)).toBe(true);
    expect(items.every((i) => i.filename.endsWith(".pdf"))).toBe(true);
  });
});
