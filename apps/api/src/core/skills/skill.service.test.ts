import { describe, expect, it, vi } from "vitest";
import { SkillService, SKILL_CATALOG } from "./skill.service.js";
import type { ScheduledTaskService, ScheduledTaskRecord } from "../engine/scheduled-task.service.js";

function scheduleRow(id: string, name: string, enabled = true): ScheduledTaskRecord {
  return {
    id,
    name,
    title: "t",
    prompt: "p",
    model: null,
    maxSteps: 5,
    maxTokens: null,
    kind: "cron",
    spec: { cron: "0 8 * * *" },
    enabled,
    nextRunAt: new Date("2026-08-06T08:00:00Z"),
    lastRunAt: null,
    runCount: 0,
    lastError: null,
    workflowId: null,
    createdAt: new Date("2026-08-05T00:00:00Z"),
    updatedAt: new Date("2026-08-05T00:00:00Z"),
  };
}

function makeSchedules(rows: ScheduledTaskRecord[] = []) {
  const store = { rows: [...rows] };
  return {
    store,
    findAll: vi.fn(async () => store.rows),
    create: vi.fn(async (dto: { name: string; kind: string; cron: string; task: Record<string, unknown>; enabled?: boolean }) => {
      const row = scheduleRow(`sched-${store.rows.length + 1}`, dto.name, dto.enabled ?? true);
      store.rows.push(row);
      return row;
    }),
    remove: vi.fn(async (id: string) => {
      const i = store.rows.findIndex((r) => r.id === id);
      if (i < 0) return false;
      store.rows.splice(i, 1);
      return true;
    }),
    enable: vi.fn(async (id: string) => {
      const r = store.rows.find((x) => x.id === id);
      if (!r) return null;
      r.enabled = true;
      return r;
    }),
    disable: vi.fn(async (id: string) => {
      const r = store.rows.find((x) => x.id === id);
      if (!r) return null;
      r.enabled = false;
      return r;
    }),
  } as unknown as ScheduledTaskService & { store: { rows: ScheduledTaskRecord[] } };
}

describe("SkillService — skill marketplace (4.4)", () => {
  it("lists the catalog with install state (nothing installed → all false)", async () => {
    const sched = makeSchedules();
    const svc = new SkillService(sched);
    const skills = await svc.list();
    expect(skills.length).toBe(SKILL_CATALOG.length);
    expect(skills.every((s) => !s.installed)).toBe(true);
    expect(skills.find((s) => s.id === "daily-pr-triage")?.cron).toBe("0 8 * * *");
  });

  it("install creates a skill:<id> cron schedule and flips the state", async () => {
    const sched = makeSchedules();
    const svc = new SkillService(sched);
    const skill = await svc.install("daily-pr-triage");
    expect(skill?.installed).toBe(true);
    expect(skill?.scheduleId).toBe("sched-1");
    expect(sched.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "skill:daily-pr-triage",
        kind: "cron",
        cron: "0 8 * * *",
        enabled: true,
      }),
    );
    expect((sched.create.mock.calls[0]?.[0] as { task: { maxSteps: number } }).task.maxSteps).toBe(8);
  });

  it("install is idempotent", async () => {
    const sched = makeSchedules();
    const svc = new SkillService(sched);
    await svc.install("ssl-cert-expiry-monitor");
    await svc.install("ssl-cert-expiry-monitor");
    expect(sched.create).toHaveBeenCalledTimes(1);
  });

  it("install of an unknown skill returns null", async () => {
    const svc = new SkillService(makeSchedules());
    expect(await svc.install("not-a-skill")).toBeNull();
  });

  it("uninstall removes the skill's schedule", async () => {
    const sched = makeSchedules([scheduleRow("s1", "skill:nightly-health-check")]);
    const svc = new SkillService(sched);
    expect((await svc.list()).find((s) => s.id === "nightly-health-check")?.installed).toBe(true);
    expect(await svc.uninstall("nightly-health-check")).toBe(true);
    expect(sched.remove).toHaveBeenCalledWith("s1");
    expect((await svc.list()).every((s) => !s.installed)).toBe(true);
  });

  it("toggle flips enable/disable on the schedule", async () => {
    const sched = makeSchedules([scheduleRow("s1", "skill:daily-pr-triage", true)]);
    const svc = new SkillService(sched);
    const off = await svc.toggle("daily-pr-triage");
    expect(off?.enabled).toBe(false);
    expect(sched.disable).toHaveBeenCalledWith("s1");
    const on = await svc.toggle("daily-pr-triage");
    expect(on?.enabled).toBe(true);
    expect(sched.enable).toHaveBeenCalledWith("s1");
  });

  it("degrades honestly without a DB (schedules empty → catalog with nothing installed)", async () => {
    const sched = makeSchedules();
    sched.findAll.mockResolvedValue([]);
    const svc = new SkillService(sched);
    const skills = await svc.list();
    expect(skills).toHaveLength(SKILL_CATALOG.length);
  });
});
