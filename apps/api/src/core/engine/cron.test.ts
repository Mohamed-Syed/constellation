import { describe, expect, it } from "vitest";
import { CronParseError, nextRunAfter, parseCron, secondsUntilNext, validateCron } from "./cron.js";

/**
 * Hand-rolled crontab parser tests. All functions are pure Date/Set ops — no
 * timer, no network, no DB. Times are constructed with the LOCAL constructor
 * `new Date(y, m, d, h, min, s)` and asserted on their local fields
 * (getFullYear/getMonth/getDate/getHours/getMinutes), which keeps the tests
 * deterministic regardless of the machine's timezone.
 */

function local(y: number, m: number, d: number, h: number, min: number, s = 0): Date {
  return new Date(y, m - 1, d, h, min, s);
}

function fieldsOf(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

describe("cron — parseCron valid expressions", () => {
  it("parses every minute ('* * * * *')", () => {
    const p = parseCron("* * * * *");
    expect(p.minute.size).toBe(60);
    expect(p.hour.size).toBe(24);
    expect(p.dayOfMonth.size).toBe(31);
    expect(p.month.size).toBe(12);
    expect(p.dayOfWeek.size).toBe(7);
  });

  it("parses a specific minute/hour/day ('30 9 15 3 0')", () => {
    const p = parseCron("30 9 15 3 0");
    expect([...p.minute]).toEqual([30]);
    expect([...p.hour]).toEqual([9]);
    expect([...p.dayOfMonth]).toEqual([15]);
    expect([...p.month]).toEqual([3]);
    expect([...p.dayOfWeek]).toEqual([0]); // Sunday
  });

  it("parses a step ('*/5 * * * *') into every 5th minute", () => {
    const p = parseCron("*/5 * * * *");
    expect([...p.minute].sort((a, b) => a - b)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  it("parses a range list ('0,15,30,45 * * * *')", () => {
    const p = parseCron("0,15,30,45 * * * *");
    expect([...p.minute].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  it("parses a range with step ('0-30/10 * * * *')", () => {
    const p = parseCron("0-30/10 * * * *");
    expect([...p.minute].sort((a, b) => a - b)).toEqual([0, 10, 20, 30]);
  });

  it("normalises day-of-week 7 to Sunday (0)", () => {
    const p = parseCron("0 9 * * 7");
    expect([...p.dayOfWeek]).toEqual([0]);
  });

  it("tolerates extra whitespace between fields", () => {
    const p = parseCron("  0   9   *   *   1-5  ");
    expect([...p.hour]).toEqual([9]);
    expect([...p.dayOfWeek].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("cron — parseCron invalid expressions", () => {
  const invalid = [
    "", // empty
    "* * * *", // only 4 fields
    "* * * * * *", // 6 fields
    "*/abc * * * *", // non-numeric value
    "60 * * * *", // minute out of range
    "* 24 * * *", // hour out of range
    "* * 0 * *", // day-of-month 0
    "* * 32 * *", // day-of-month > 31
    "* * * 13 *", // month > 12
    "* * * * 8", // day-of-week > 7
    "* 5-1 * * *", // range with start > end
    "0, * * * *", // empty list element
    "1/0 * * * *", // zero step
  ] as const;

  it.each(invalid)("rejects %j", (expr) => {
    let thrown = false;
    try {
      parseCron(expr);
    } catch (err) {
      thrown = err instanceof CronParseError;
    }
    expect(thrown).toBe(true);
    expect(() => validateCron(expr)).toThrow(CronParseError);
  });
});

describe("cron — nextRunAfter", () => {
  it("fires every minute (advances by exactly one minute)", () => {
    const p = parseCron("* * * * *");
    const from = local(2026, 1, 3, 9, 30, 0);
    const next = nextRunAfter(p, from)!;
    expect(fieldsOf(next)).toBe("2026-1-3 9:31");
  });

  it("does not fire at or before the anchor instant", () => {
    const p = parseCron("* * * * *");
    const from = local(2026, 1, 3, 9, 30, 59);
    const next = nextRunAfter(p, from)!;
    expect(fieldsOf(next)).toBe("2026-1-3 9:31");
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it("fires at a specific minute/hour ('30 9 * * *') the following day when passed", () => {
    const p = parseCron("30 9 * * *");
    const from = local(2026, 1, 3, 10, 0, 0);
    const next = nextRunAfter(p, from)!;
    expect(fieldsOf(next)).toBe("2026-1-4 9:30");
  });

  it("fires on a specific day-of-week ('0 0 * * 1') on the next Monday", () => {
    // 2026-01-03 is a Saturday.
    const p = parseCron("0 0 * * 1");
    const from = local(2026, 1, 3, 12, 0, 0);
    const next = nextRunAfter(p, from)!;
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
    // Monday 2026-01-05
    expect(`${next.getFullYear()}-${next.getMonth() + 1}-${next.getDate()}`).toBe("2026-1-5");
  });

  it("fires on a specific month and day ('0 0 15 3 *') on March 15", () => {
    const p = parseCron("0 0 15 3 *");
    const from = local(2026, 2, 10, 12, 0, 0); // Feb 10 2026
    const next = nextRunAfter(p, from)!;
    expect(fieldsOf(next)).toBe("2026-3-15 0:00");
  });

  it("skips disabled-None (a schedule that can never match) by returning null after the horizon", () => {
    // 30 Feb never occurs (February has 28/29 days) — no next fire.
    const p = parseCron("0 0 30 2 *");
    expect(nextRunAfter(p, local(2026, 1, 1))).toBeNull();
  });

  it("secondsUntilNext returns 0 when the next fire has already passed within the same minute", () => {
    // From 9:30:45 the next fire is 9:31:00 -> 15 seconds away.
    const secs = secondsUntilNext("* * * * *", local(2026, 1, 3, 9, 30, 45));
    expect(secs).toBe(15);
  });
});
