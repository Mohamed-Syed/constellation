import { describe, expect, it } from "vitest";
import { auditToPdf } from "./pdf-export.js";
import type { AuditEntry } from "./audit.service.js";

function row(id: string, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id,
    pluginId: "core",
    actorId: "user-1",
    action: "workflow.run",
    metadata: { workflowId: "wf1" },
    createdAt: new Date("2026-08-05T00:00:00Z"),
    ...overrides,
  };
}

describe("auditToPdf — zero-dep PDF compliance export (4.7 tail)", () => {
  it("emits a structurally valid PDF with the rows in the content stream", () => {
    const pdf = auditToPdf([row("a1"), row("a2", { actorId: "user-2", action: "auth.login" })]);
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Type /Pages");
    expect(text).toContain("/Count 1");
    expect(text).toContain("/Type /Page");
    expect(text).toContain("startxref");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // The rows are drawn as text in the content stream.
    expect(text).toContain("workflow.run");
    expect(text).toContain("auth.login");
    expect(text).toContain("user-2");
  });

  it("escapes hostile content so it cannot break the file", () => {
    const pdf = auditToPdf([row("x1", { action: ")(evil\\break", actorId: "a)b" })]);
    const text = pdf.toString("latin1");
    expect(text).toContain("\\(");
    expect(text).toContain("\\)");
    expect(text).toContain("\\\\");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("flows many rows onto multiple pages", () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(`r${i}`, { action: `action-${i}` }));
    const text = auditToPdf(rows).toString("latin1");
    const count = text.match(/\/Count (\d+)/)?.[1];
    expect(Number(count)).toBeGreaterThan(1);
  });
});
