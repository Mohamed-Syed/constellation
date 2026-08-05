import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service.js";

/** A row as returned by `list()` — mirrors the `AuditLog` Prisma model. */
export interface AuditEntry {
  id: string;
  pluginId: string;
  actorId: string | null;
  action: string;
  metadata: unknown;
  createdAt: Date;
}

/**
 * Writes to the immutable-by-convention `AuditLog` table. No-op-with-warn
 * when there's no database — an audit failure must never break the action
 * being audited, so `record()` swallows its own errors (logged, not thrown).
 *
 * Global (see `audit.module.ts`) so any core or plugin-facing service —
 * including ones outside this workstream's ownership, e.g. Nova's plugin
 * enable/disable mutations — can inject `AuditService` and call `record()`
 * without importing this module directly.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param actorId  The acting user's id, or `null` for system/background actions.
   * @param action   A short, stable verb-phrase, e.g. `"auth.login"`, `"plugin.enable"`.
   * @param target   What was acted on (e.g. a plugin id or user email). Folded into `metadata.target`.
   * @param metadata Any other structured detail worth keeping.
   * @param pluginId The originating plugin, or `"core"` for platform actions (default).
   */
  async record(
    actorId: string | null,
    action: string,
    target?: string,
    metadata?: Record<string, unknown>,
    pluginId = "core",
  ): Promise<void> {
    const db = this.prisma.db;
    if (!db) {
      this.logger.warn(`Audit skipped (no database): ${action}${target ? ` on ${target}` : ""}`);
      return;
    }
    try {
      await db.auditLog.create({
        data: {
          pluginId,
          actorId,
          action,
          metadata: (target ? { target, ...metadata } : metadata) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write audit log entry for "${action}": ${asMessage(err)}`);
    }
  }

  /** Most recent audit entries, newest first. Empty array with no database. */
  async list(limit = 100): Promise<AuditEntry[]> {
    const db = this.prisma.db;
    if (!db) return [];
    return db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  /**
   * Compliance-export query (Phase 4.0): optional actor/action substring
   * filters, newest first, capped at 1000 rows for a sane CSV.
   */
  async listForExport(opts: { limit?: number; actor?: string; action?: string } = {}): Promise<AuditEntry[]> {
    const db = this.prisma.db;
    if (!db) return [];
    const where: Record<string, unknown> = {};
    if (opts.actor) where.actorId = { contains: opts.actor };
    if (opts.action) where.action = { contains: opts.action };
    return db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(opts.limit ?? 1000, 1), 1000),
    });
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** One audit row as the API returns it (the Prisma row's scalar shape). */
export interface AuditEntry {
  id: string;
  pluginId: string;
  actorId: string | null;
  action: string;
  metadata: unknown;
  createdAt: Date;
}

/**
 * Phase 4.0 — compliance export: audit rows → RFC-4180 CSV (header + rows,
 * quoting fields containing commas, quotes or newlines; metadata JSON-encoded).
 * Pure function, unit tested; the controller streams the result as a download.
 */
export function auditToCsv(rows: AuditEntry[]): string {
  const escape = (value: string | null | undefined): string => {
    const s = value ?? "";
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "createdAt,actorId,action,metadata";
  const lines = rows.map((r) =>
    [
      r.createdAt.toISOString(),
      escape(r.actorId),
      escape(r.action),
      escape(r.metadata === undefined || r.metadata === null ? null : JSON.stringify(r.metadata)),
    ].join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}
