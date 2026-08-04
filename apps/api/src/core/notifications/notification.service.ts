import { Injectable, Logger, Optional, OnModuleInit } from "@nestjs/common";
import { EventBusService } from "../events/event-bus.service.js";
// VALUE import (not `import type`): PrismaService is a constructor-injected
// dependency, and `import type` erases the runtime metadata Nest reflects —
// the container then sees `Function` at index [0] and the live boot fails
// with "Nest can't resolve dependencies of the NotificationService (?, ...)"
// while every offline `new NotificationService(...)` test stays green.
// Same class of bug as the OTel round (see constellation-platform skill,
// "NestJS DI param traps" #3).
import { PrismaService } from "../database/prisma.service.js";

/** One durable notification row as returned by the API (dates serialized). */
export interface NotificationRecord {
  id: string;
  /** Semantic topic the notification was born from, e.g. "engine.task.failed". */
  kind: string;
  /** info | success | warning | error — drives the portal's icon/colour. */
  severity: string;
  title: string;
  message: string | null;
  refType: string | null;
  refId: string | null;
  read: boolean;
  createdAt: string;
}

/** Outcome of list() — items newest-first plus the total unread count (for the sidebar badge). */
export interface NotificationListResult {
  items: NotificationRecord[];
  unreadCount: number;
}

/** Safety cap on stored title/message length (a rogue error string must not bloat the table). */
const MAX_TEXT_LENGTH = 500;

/**
 * Phase 3.0 — Notification Center.
 *
 * The durable counterpart to the engine's in-memory alert ring buffer
 * (EngineAlertService). Subscribes to the platform EventBus ("core" scope)
 * and persists every notable event into the `notifications` table, so the
 * feed survives restarts and is queryable / markable-read:
 *
 *   engine.task.failed | stale | recovered        (Engine v0.5 alerts)
 *   scheduler.schedule.fired | error              (Engine v0.4 scheduler)
 *
 * The service is DECOUPLED from its sources — it only listens. A future
 * source (workflow runs, plugin lifecycle, ...) needs no changes here; it
 * just emits onto the bus and notifications appear. Mutations are read/
 * mark-read/dismiss only; the feed itself is written by events, never by
 * the portal.
 *
 * Degrade discipline (same as every core service): with no database the
 * service warns ONCE and behaves as an empty feed — nothing throws, the
 * platform still boots, and live events are simply not persisted.
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private warnedNoDb = false;
  private started = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /** The EventBus topics this center persists (all "core" scope). */
  static readonly SOURCE_TOPICS = [
    "engine.task.failed",
    "engine.task.stale",
    "engine.task.recovered",
    "scheduler.schedule.fired",
    "scheduler.schedule.error",
  ] as const;

  onModuleInit(): void {
    if (this.started || !this.eventBus) return;
    this.started = true;
    const events = this.eventBus.forPlugin("core");
    for (const topic of NotificationService.SOURCE_TOPICS) {
      events.on(topic, (payload: unknown) => {
        void this.handleBusEvent(topic, payload).catch((err) =>
          this.logger.warn(`Notification handler for "${topic}" rejected: ${asMessage(err)}`),
        );
      });
    }
    this.logger.log(`Notification center listening on ${NotificationService.SOURCE_TOPICS.length} platform topics`);
  }

  /**
   * Public write seam — used by the bus handlers and available for future
   * direct callers (e.g. a workflow run completing). Never throws.
   */
  async record(
    kind: string,
    severity: string,
    title: string,
    message: string | null = null,
    refType: string | null = null,
    refId: string | null = null,
  ): Promise<void> {
    const db = this.prisma.db;
    if (!db) {
      if (!this.warnedNoDb) {
        this.warnedNoDb = true;
        this.logger.warn(`Notification not persisted (no database): ${kind} — ${title}`);
      }
      return;
    }
    try {
      await db.notification.create({
        data: {
          kind,
          severity,
          title: clamp(title),
          message: message === null ? null : clamp(message),
          refType,
          refId,
          read: false,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to persist notification "${kind}": ${asMessage(err)}`);
    }
  }

  /** Recent notifications, newest first. `limit` caps the page; kind/unread filter it. */
  async list(limit = 50, kind?: string, unreadOnly = false): Promise<NotificationListResult> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return { items: [], unreadCount: 0 };
    }
    const where: Record<string, unknown> = {};
    if (kind) where.kind = kind;
    if (unreadOnly) where.read = false;
    try {
      const [rows, unreadCount] = await Promise.all([
        db.notification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: Math.min(Math.max(limit, 1), 100),
        }),
        db.notification.count({ where: { read: false } }),
      ]);
      return { items: rows.map(serialize), unreadCount };
    } catch (err) {
      this.logger.warn(`Notification list failed: ${asMessage(err)}`);
      return { items: [], unreadCount: 0 };
    }
  }

  /** Total unread notifications — powers the portal sidebar badge. */
  async unreadCount(): Promise<number> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return 0;
    }
    try {
      return await db.notification.count({ where: { read: false } });
    } catch (err) {
      this.logger.warn(`Notification unread count failed: ${asMessage(err)}`);
      return 0;
    }
  }

  /** Mark one notification read. Resolves the row, or null when it doesn't exist. */
  async markRead(id: string): Promise<NotificationRecord | null> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return null;
    }
    try {
      const row = await db.notification.findUnique({ where: { id } });
      if (!row) return null;
      const updated = await db.notification.update({ where: { id }, data: { read: true } });
      return serialize(updated);
    } catch (err) {
      this.logger.warn(`Notification mark-read failed for ${id}: ${asMessage(err)}`);
      return null;
    }
  }

  /** Mark every notification read. Resolves the number of rows flipped. */
  async markAllRead(): Promise<number> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return 0;
    }
    try {
      const result = await db.notification.updateMany({
        where: { read: false },
        data: { read: true },
      });
      return result.count;
    } catch (err) {
      this.logger.warn(`Notification mark-all-read failed: ${asMessage(err)}`);
      return 0;
    }
  }

  /** Dismiss (delete) one notification. Resolves the row, or null when it doesn't exist. */
  async dismiss(id: string): Promise<NotificationRecord | null> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return null;
    }
    try {
      const row = await db.notification.findUnique({ where: { id } });
      if (!row) return null;
      await db.notification.delete({ where: { id } });
      return serialize(row);
    } catch (err) {
      this.logger.warn(`Notification dismiss failed for ${id}: ${asMessage(err)}`);
      return null;
    }
  }

  /** Map a bus event payload onto a notification row and persist it. */
  private async handleBusEvent(topic: string, payload: unknown): Promise<void> {
    const p = asObject(payload);
    switch (topic) {
      case "engine.task.failed": {
        const taskId = str(p.taskId);
        await this.record("engine.task.failed", "error", "Task failed", str(p.detail), "task", taskId);
        return;
      }
      case "engine.task.stale": {
        const taskId = str(p.taskId);
        await this.record(
          "engine.task.stale",
          "warning",
          "Task flagged stale",
          `No progress for ${str(p.detail) || "an extended period"}`,
          "task",
          taskId,
        );
        return;
      }
      case "engine.task.recovered": {
        const taskId = str(p.taskId);
        await this.record(
          "engine.task.recovered",
          "success",
          "Task recovered",
          "Re-enqueued after being flagged stale",
          "task",
          taskId,
        );
        return;
      }
      case "scheduler.schedule.fired": {
        const scheduleId = str(p.scheduleId);
        const name = str(p.name) || "Schedule";
        const taskId = str(p.taskId);
        await this.record(
          "scheduler.schedule.fired",
          "info",
          "Schedule fired",
          `${name}${taskId ? ` → task ${taskId}` : ""}`,
          "schedule",
          scheduleId,
        );
        return;
      }
      case "scheduler.schedule.error": {
        const scheduleId = str(p.scheduleId);
        const name = str(p.name) || "Schedule";
        const error = str(p.error);
        await this.record(
          "scheduler.schedule.error",
          "error",
          "Schedule run failed",
          `${name}${error ? `: ${error}` : ""}`,
          "schedule",
          scheduleId,
        );
        return;
      }
      default:
        this.logger.warn(`Unhandled notification topic "${topic}" — ignoring`);
    }
  }

  private warnNoDbOnce(): void {
    if (!this.warnedNoDb) {
      this.warnedNoDb = true;
      this.logger.warn("Notification center has no database — acting as an empty feed");
    }
  }
}

function serialize(row: {
  id: string;
  kind: string;
  severity: string;
  title: string;
  message: string | null;
  refType: string | null;
  refId: string | null;
  read: boolean;
  createdAt: Date;
}): NotificationRecord {
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    message: row.message,
    refType: row.refType,
    refId: row.refId,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
}

function clamp(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…` : text;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
