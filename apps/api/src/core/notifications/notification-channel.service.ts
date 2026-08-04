import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service.js";

/** A configured outbound notification channel (webhook family today). */
export interface NotificationChannel {
  id: string;
  name: string;
  type: "webhook";
  /** Target URL (http/https). */
  url: string;
  /** Envelope shape: slack | discord | teams | generic. */
  format: "slack" | "discord" | "teams" | "generic";
  /** Notification kinds this channel receives; empty = ALL kinds. */
  kinds: string[];
  enabled: boolean;
}

export const CHANNEL_FORMATS = ["slack", "discord", "teams", "generic"] as const;

/** Persisted under one core settings key (JSON array of channels). */
const SETTINGS_PLUGIN = "core";
const SETTINGS_KEY = "notification.channels";

/** One dispatched event payload handed to every matching channel. */
export interface ChannelEventPayload {
  kind: string;
  severity: string;
  title: string;
  message: string | null;
  refType: string | null;
  refId: string | null;
}

const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Phase 3.0 — notification CHANNELS (the §7-BIS 3.5 vision remainder).
 *
 * Outbound delivery for the durable notification feed: every persisted event
 * is dispatched (fire-and-forget, never throws) to each ENABLED channel whose
 * `kinds` filter matches. Webhook family with four envelope dialects:
 *
 *   slack  — `{ text }` (chat.postMessage-compatible body)
 *   discord— `{ content }` (webhook body)
 *   teams  — legacy MessageCard (`@type: MessageCard` — the shape most
 *            existing Teams connectors accept)
 *   generic— `{ title, message, kind, severity, ... }` (any HTTP endpoint)
 *
 * Storage: one JSON setting under `core::notification.channels`, read straight
 * from the settings table (no-DB → empty channel list, dispatch is a no-op —
 * same degrade discipline as every core service). Zero new dependencies:
 * delivery uses the global `fetch` with `AbortSignal.timeout`.
 *
 * Email/SMTP delivery remains a documented future channel (SMTP needs a
 * real outbound transport; the envelope seam is exactly where it would slot).
 */
@Injectable()
export class NotificationChannelService {
  private readonly logger = new Logger(NotificationChannelService.name);
  private warnedNoDb = false;

  constructor(private readonly prisma: PrismaService) {}

  /** The configured channels (cached read of the JSON setting). */
  async list(): Promise<NotificationChannel[]> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return [];
    }
    try {
      const row = await db.setting.findUnique({
        where: { pluginId_key: { pluginId: SETTINGS_PLUGIN, key: SETTINGS_KEY } },
      });
      if (!row) return [];
      const parsed: unknown = row.value;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isChannel);
    } catch (err) {
      this.logger.warn(`Could not read notification channels: ${asMessage(err)}`);
      return [];
    }
  }

  /** Validate + create/update a channel (id present = update). Never throws on DB absence — returns null. */
  async upsert(input: {
    id?: string;
    name: string;
    type?: string;
    url: string;
    format?: string;
    kinds?: string[];
    enabled?: boolean;
  }): Promise<NotificationChannel | null> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return null;
    }
    const channels = await this.list();
    const existing = input.id ? channels.find((c) => c.id === input.id) : undefined;
    const channel: NotificationChannel = {
      id: existing?.id ?? newId(),
      name: input.name.trim(),
      type: "webhook",
      url: input.url.trim(),
      format: (CHANNEL_FORMATS as readonly string[]).includes(input.format ?? "") ? (input.format as NotificationChannel["format"]) : "generic",
      kinds: Array.isArray(input.kinds) ? input.kinds.filter((k) => typeof k === "string") : [],
      enabled: input.enabled ?? true,
    };
    const next = existing ? channels.map((c) => (c.id === channel.id ? channel : c)) : [...channels, channel];
    await this.save(next);
    return channel;
  }

  /** Delete a channel by id; resolves true when removed, false when unknown. */
  async remove(id: string): Promise<boolean> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return false;
    }
    const channels = await this.list();
    const next = channels.filter((c) => c.id !== id);
    if (next.length === channels.length) return false;
    await this.save(next);
    return true;
  }

  /** Deliver a TEST message through one channel (used by the Test button). */
  async sendTest(channel: NotificationChannel): Promise<{ ok: boolean; status?: number; error?: string }> {
    return this.deliver(channel, {
      kind: "notification.channel.test",
      severity: "info",
      title: "Constellation test message",
      message: `Channel "${channel.name}" is wired up correctly.`,
      refType: null,
      refId: null,
    });
  }

  /**
   * Dispatch one persisted event to every matching enabled channel.
   * Fire-and-forget: a failing webhook is logged (once per channel) and
   * NEVER propagates — the notification feed must not depend on delivery.
   */
  async dispatch(kind: string, payload: ChannelEventPayload): Promise<void> {
    const channels = await this.list();
    for (const channel of channels) {
      if (!channel.enabled) continue;
      if (channel.kinds.length > 0 && !channel.kinds.includes(kind)) continue;
      const result = await this.deliver(channel, payload);
      if (!result.ok) {
        this.logger.warn(
          `Webhook "${channel.name}" (${channel.format}) failed for ${kind}: ${result.error ?? `HTTP ${result.status}`}`,
        );
      }
    }
  }

  /** POST the envelope for one channel; resolves the outcome, never throws. */
  private async deliver(
    channel: NotificationChannel,
    payload: ChannelEventPayload,
  ): Promise<{ ok: boolean; status?: number; error?: string }> {
    let body: unknown;
    try {
      body = buildEnvelope(channel.format, payload);
    } catch (err) {
      return { ok: false, error: asMessage(err) };
    }
    try {
      const res = await fetch(channel.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, error: asMessage(err) };
    }
  }

  private async save(channels: NotificationChannel[]): Promise<void> {
    const db = this.prisma.db;
    if (!db) return;
    await db.setting.upsert({
      where: { pluginId_key: { pluginId: SETTINGS_PLUGIN, key: SETTINGS_KEY } },
      create: {
        pluginId: SETTINGS_PLUGIN,
        key: SETTINGS_KEY,
        value: channels as unknown as Prisma.InputJsonValue,
      },
      update: { value: channels as unknown as Prisma.InputJsonValue },
    });
  }

  private warnNoDbOnce(): void {
    if (!this.warnedNoDb) {
      this.warnedNoDb = true;
      this.logger.warn("Notification channels have no database — acting as an empty list");
    }
  }
}

/** Map an event onto the envelope dialect. Pure + unit-testable. */
export function buildEnvelope(
  format: NotificationChannel["format"],
  payload: ChannelEventPayload,
): Record<string, unknown> {
  const text = payload.message ? `${payload.title} — ${payload.message}` : payload.title;
  switch (format) {
    case "slack":
      return { text };
    case "discord":
      return { content: text };
    case "teams":
      return {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        summary: payload.title,
        title: payload.title,
        text: payload.message ?? "",
        sections: [
          {
            facts: [
              { name: "Kind", value: payload.kind },
              { name: "Severity", value: payload.severity },
              ...(payload.refType && payload.refId
                ? [{ name: payload.refType, value: payload.refId }]
                : []),
            ],
          },
        ],
      };
    case "generic":
    default:
      return {
        title: payload.title,
        message: payload.message,
        kind: payload.kind,
        severity: payload.severity,
        refType: payload.refType,
        refId: payload.refId,
      };
  }
}

function isChannel(value: unknown): value is NotificationChannel {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.name === "string" &&
    c.type === "webhook" &&
    typeof c.url === "string" &&
    (CHANNEL_FORMATS as readonly string[]).includes(c.format as string) &&
    Array.isArray(c.kinds) &&
    typeof c.enabled === "boolean"
  );
}

function newId(): string {
  return `ch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
