/**
 * Minimal, zero-dependency 5-field crontab parser (Engine v0.4).
 *
 * The scheduler deps only have BullMQ/ioredis — no cron package is installed,
 * and the task explicitly prefers a hand-rolled parser over adding a heavy dep
 * (same rationale as the codebase's zero-dep global `fetch` / `AbortSignal`
 * pattern in `model-provider.ts`). This module supports the common crontab
 * subset:
 *
 *   field  meaning          range
 *   ─────────────────────────────────
 *   1      minute           0-59
 *   2      hour             0-23
 *   3      day of month     1-31
 *   4      month            1-12
 *   5      day of week      0-7   (0 and 7 both mean Sunday; 7 is normalised to 0)
 *
 * Each field accepts `*`, a single value, a range `a-b`, a list `a,b,c`, or a
 * step (`slash`-prefixed, e.g. "every-N"). `nextRunAfter`/`secondsUntilNext`
 * compute the next fire time AFTER a given instant (never at or before it, so
 * the poll loop can't re-fire the same instant).
 *
 * NOTE (honest limitation): day-of-month and day-of-week are ANDed (both must
 * match), matching the intuitive reading — classic Vixie cron ORs them when
 * both are restricted. For the common cadences people actually schedule
 * ("0 9 * * 1-5", "every-5 minutes") AND semantics are correct; a schedule
 * that relies on full crontab OR-of-dom/dow semantics is out of scope for v0.4.
 *
 * All functions are pure and take/return plain `Date`s / numbers, so they are
 * trivially unit-testable offline with no timer/network.
 */

/** Thrown for a malformed crontab expression (bad field count, bad token, or an out-of-range value). */
export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronParseError";
  }
}

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  /** 1-31 */
  dayOfMonth: Set<number>;
  /** 1-12 */
  month: Set<number>;
  /** 0-6 (Sunday = 0) */
  dayOfWeek: Set<number>;
}

const MIN_MINUTE = 0, MAX_MINUTE = 59;
const MIN_HOUR = 0, MAX_HOUR = 23;
const MIN_DOM = 1, MAX_DOM = 31;
const MIN_MONTH = 1, MAX_MONTH = 12;
const MIN_DOW = 0, MAX_DOW = 7; // 7 == Sunday (normalised to 0)

const FIELD_LIMITS: Array<[number, number]> = [
  [MIN_MINUTE, MAX_MINUTE],
  [MIN_HOUR, MAX_HOUR],
  [MIN_DOM, MAX_DOM],
  [MIN_MONTH, MAX_MONTH],
  [MIN_DOW, MAX_DOW],
];

/** Parse a 5-field crontab expression into discrete allowed-value sets. */
export function parseCron(cron: string): CronFields {
  if (typeof cron !== "string" || cron.trim() === "") {
    throw new CronParseError("cron expression must be a non-empty string");
  }
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronParseError(
      `cron expression must have 5 fields (minute hour dom month dow), got ${parts.length}`,
    );
  }
  const sets = parts.map((field, i) => parseCronField(field, i));
  return {
    minute: sets[0]!,
    hour: sets[1]!,
    dayOfMonth: sets[2]!,
    month: sets[3]!,
    dayOfWeek: normaliseDow(sets[4]!),
  };
}

/** Parse and validate one crontab field, returning its set of allowed values. */
function parseCronField(field: string, index: number): Set<number> {
  const [min, max] = FIELD_LIMITS[index]!;
  const out = new Set<number>();
  // split on ',' but allow it to look like "5,10"; note a spurious leading/trailing comma is an error
  const list = field.split(",");
  if (list.some((t) => t.trim() === "")) {
    throw new CronParseError(`empty list element in field ${index + 1} ("${field}")`);
  }
  for (const token of list) {
    addTokenRange(out, token.trim(), min, max, index);
  }
  if (out.size === 0) {
    throw new CronParseError(`field ${index + 1} ("${field}") matches nothing`);
  }
  return out;
}

/** Expand a single token (value, `*`, `a-b`, or a slash-step) into `out`. */
function addTokenRange(out: Set<number>, token: string, min: number, max: number, fieldIndex: number): void {
  const stepMatch = token.split("/");
  if (stepMatch.length > 2) {
    throw new CronParseError(`bad step ("${token}") in field ${fieldIndex + 1}`);
  }
  const step = stepMatch.length === 2 ? parseStep(stepMatch[1]!, token, fieldIndex) : 1;

  let rangeStart: number;
  let rangeEnd: number;
  if (stepMatch[0] === "*") {
    rangeStart = min;
    rangeEnd = max;
  } else {
    const rangeParts = stepMatch[0]!.split("-");
    if (rangeParts.length === 1) {
      const v = parseValue(rangeParts[0]!, token, fieldIndex, min, max);
      rangeStart = v;
      rangeEnd = v;
    } else if (rangeParts.length === 2) {
      const a = parseValue(rangeParts[0]!, token, fieldIndex, min, max);
      const b = parseValue(rangeParts[1]!, token, fieldIndex, min, max);
      if (a > b) {
        // Allow wrap-around ranges like the dow field "5-7"? Cron does not;
        // reject to keep semantics predictable.
        throw new CronParseError(
          `range start "${a}" is greater than end "${b}" in field ${fieldIndex + 1} ("${token}")`,
        );
      }
      rangeStart = a;
      rangeEnd = b;
    } else {
      throw new CronParseError(`bad range ("${token}") in field ${fieldIndex + 1}`);
    }
  }

  for (let v = rangeStart; v <= rangeEnd; v += step) {
    out.add(v);
  }
}

function parseStep(text: string, token: string, fieldIndex: number): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) {
    throw new CronParseError(`bad step value "${text}" in field ${fieldIndex + 1} ("${token}")`);
  }
  return n;
}

function parseValue(text: string, token: string, fieldIndex: number, min: number, max: number): number {
  if (!/^\d+$/.test(text)) {
    throw new CronParseError(`bad value "${text}" in field ${fieldIndex + 1} ("${token}")`);
  }
  const n = Number(text);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new CronParseError(
      `value "${text}" out of range [${min}-${max}] in field ${fieldIndex + 1} ("${token}")`,
    );
  }
  return n;
}

/** Normalise Sunday aliases so 0 and 7 both collapse to 0. */
function normaliseDow(dow: Set<number>): Set<number> {
  const out = new Set<number>();
  for (const v of dow) {
    out.add(v === 7 ? 0 : v);
  }
  return out;
}

/**
 * Compute the next fire time STRICTLY AFTER `after` for a parsed expression,
 * or null if none exists within a 5-year horizon (a safeguard against a
 * pathological, never-matching schedule spinning forever — an honest null
 * beats an unbounded loop).
 */
export function nextRunAfter(parsed: CronFields, after: Date): Date | null {
  // Start strictly one second past `after` so the same instant never re-fires.
  const d = new Date(after.getTime());
  d.setMilliseconds(0);
  d.setSeconds(d.getSeconds() + 1);

  // Snap to the minute just after `after`. If zeroing the seconds stranded us
  // back at/before `after` (e.g. we were exactly on a minute boundary), step
  // forward one minute so the candidate is ALWAYS strictly after `after`.
  d.setSeconds(0, 0);
  if (d.getTime() <= after.getTime()) {
    d.setMinutes(d.getMinutes() + 1, 0, 0);
  }

  const horizonYear = after.getFullYear() + 5;
  // Safety net for pathological cases: ~5 years of minutes.
  let guard = 0;
  const guardMax = 60 * 24 * 366 * 5;

  while (guard++ < guardMax) {
    if (d.getFullYear() > horizonYear) return null;

    // Month
    if (!parsed.month.has(d.getMonth() + 1)) {
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      d.setMonth(d.getMonth() + 1);
      continue;
    }
    // Day-of-month AND day-of-week must both match (AND semantics).
    if (!parsed.dayOfMonth.has(d.getDate())) {
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 1);
      continue;
    }
    if (!parsed.dayOfWeek.has(d.getDay())) {
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 1);
      continue;
    }
    // Hour
    if (!parsed.hour.has(d.getHours())) {
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + 1);
      continue;
    }
    // Minute
    if (!parsed.minute.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  return null;
}

/** Validate an expression (throws NotFound->400 semantics elsewhere) and return a friendly result. */
export function validateCron(cron: string): void {
  parseCron(cron); // throws CronParseError on any problem
}

/** Convenience: seconds until the next fire after `from`, or null if none. */
export function secondsUntilNext(expr: string, from: Date): number | null {
  const parsed = parseCron(expr);
  const next = nextRunAfter(parsed, from);
  if (next === null) return null;
  return Math.max(0, Math.floor((next.getTime() - from.getTime()) / 1000));
}
