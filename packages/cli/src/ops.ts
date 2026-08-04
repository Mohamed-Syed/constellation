/**
 * Operational CLI commands for Constellation (Phase 2.0 #2.5 — "A CLI that
 * matches the API"). These mirror the platform's REST surface so an operator
 * can inspect engine health, tasks, schedules, dead letters and plugins
 * without opening the portal.
 *
 * The API base defaults to `CONSTELLATION_URL` (or `http://localhost:4001/api`)
 * and the access token to `CONSTELLATION_TOKEN` (bearer). Both are overridable
 * via flags on the parent command. Every request degrades gracefully: a
 * dead/unreachable API prints a clear error and exits non-zero, never throws.
 */

import { Command } from "commander";

const DEFAULT_BASE = process.env.CONSTELLATION_URL ?? "http://localhost:4001/api";

interface OpsOptions {
  url?: string;
  token?: string;
}

async function apiJson(
  base: string,
  token: string | undefined,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function printTable(rows: Record<string, unknown>[], cols?: string[]): void {
  if (rows.length === 0) {
    console.log("(none)");
    return;
  }
  const keys =
    cols ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  // Compute column widths
  const widths = keys.map((k) =>
    Math.min(48, Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length))),
  );
  const line = (r: Record<string, unknown>) =>
    keys.map((k, i) => String(r[k] ?? "").padEnd(widths[i]!)).join("  ").trimEnd();
  console.log(line(Object.fromEntries(keys.map((k) => [k, k]))));
  console.log("-".repeat(widths.reduce((a, b) => a + b + 2, 0)));
  for (const row of rows) console.log(line(row));
}

function pick<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, row[k] ?? ""])) as Record<string, unknown>;
}

// Exported for offline unit tests (not part of the public package surface).
export { apiJson, printTable, pick };

export function registerOps(parent: Command): void {
  const ops = parent
    .command("ops")
    .description("Operational commands against the Constellation API (engine, tasks, plugins).")
    .option("-u, --url <url>", "API base URL", process.env.CONSTELLATION_URL)
    .option("-t, --token <token>", "Bearer access token", process.env.CONSTELLATION_TOKEN);

  ops
    .command("health")
    .description("Show platform + engine health")
    .action(async (cmd: Command) => await healthAction(ops.opts<OpsOptions>(), cmd));

  ops
    .command("engine")
    .description("Engine status (queue, supervisor, scheduler, alerts)")
    .command("status")
    .description("Engine health (queue, supervisor, scheduler, alerts)")
    .action(async (cmd: Command) => await engineStatusAction(ops.opts<OpsOptions>(), cmd));

  ops
    .command("tasks")
    .description("List engine tasks (id, title, status, steps, created)")
    .action(async (cmd: Command) => await tasksAction(ops.opts<OpsOptions>(), cmd));

  ops
    .command("schedules")
    .description("List task schedules (id, title, kind, cron, runs)")
    .action(async (cmd: Command) => await schedulesAction(ops.opts<OpsOptions>(), cmd));

  ops
    .command("deadletters")
    .description("List failed/dead-letter tasks")
    .action(async (cmd: Command) => await deadlettersAction(ops.opts<OpsOptions>(), cmd));

  ops
    .command("plugins")
    .description("List installed plugins and their health")
    .action(async (cmd: Command) => await pluginsAction(ops.opts<OpsOptions>(), cmd));
}

async function api(opts: OpsOptions, path: string): Promise<{ status: number; body: unknown }> {
  const base = (opts.url ?? DEFAULT_BASE).replace(/\/$/, "");
  return apiJson(base, opts.token, path);
}

function requireToken(opts: OpsOptions): string {
  if (!opts.token) {
    console.error("This command needs an access token. Set CONSTELLATION_TOKEN or pass --token.");
    process.exit(1);
  }
  return opts.token;
}

async function healthAction(opts: OpsOptions, _cmd: Command): Promise<void> {
  const { status, body } = await api(opts, "/health");
  if (status >= 400) {
    console.error(`Health check failed (HTTP ${status}): is the API up?`);
    process.exit(1);
  }
  console.log(pretty(body));
}

async function engineStatusAction(opts: OpsOptions, _cmd: Command): Promise<void> {
  const { status, body } = await api(opts, "/engine/health");
  if (status >= 400) {
    console.error(`Engine health failed (HTTP ${status}).`);
    process.exit(1);
  }
  console.log(pretty(body));
}

async function tasksAction(opts: OpsOptions, _cmd: Command): Promise<void> {
  requireToken(opts);
  const { status, body } = await api(opts, "/engine/tasks");
  if (status >= 400) {
    console.error(`Couldn't list tasks (HTTP ${status}).`);
    process.exit(1);
  }
  const rows = Array.isArray(body) ? body : (body as { data?: unknown[] })?.data ?? [];
  printTable(
    rows.map((t) => pick(t as Record<string, unknown>, ["id", "title", "status", "stepCount", "createdAt"])),
  );
}

async function schedulesAction(opts: OpsOptions, _cmd: Command): Promise<void> {
  requireToken(opts);
  const { status, body } = await api(opts, "/engine/schedules");
  if (status >= 400) {
    console.error(`Couldn't list schedules (HTTP ${status}).`);
    process.exit(1);
  }
  const rows = Array.isArray(body) ? body : (body as { data?: unknown[] })?.data ?? [];
  printTable(
    rows.map((s) =>
      pick(s as Record<string, unknown>, ["id", "title", "kind", "enabled", "runCount", "nextRunAt"]),
    ),
  );
}

async function deadlettersAction(opts: OpsOptions, _cmd: Command): Promise<void> {
  requireToken(opts);
  const { status, body } = await api(opts, "/engine/deadletters");
  if (status >= 400) {
    console.error(`Couldn't list dead letters (HTTP ${status}).`);
    process.exit(1);
  }
  const rows = Array.isArray(body) ? body : (body as { data?: unknown[] })?.data ?? [];
  printTable(
    rows.map((t) =>
      pick(t as Record<string, unknown>, ["id", "title", "status", "failureClassification", "error"]),
    ),
  );
}

async function pluginsAction(opts: OpsOptions, _cmd: Command): Promise<void> {
  const { status, body } = await api(opts, "/plugins");
  if (status >= 400) {
    console.error(`Couldn't list plugins (HTTP ${status}).`);
    process.exit(1);
  }
  const rows = Array.isArray(body) ? body : (body as { data?: unknown[] })?.data ?? [];
  printTable(
    rows.map((p) => pick(p as Record<string, unknown>, ["id", "name", "version", "state"])),
  );
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
