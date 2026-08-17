import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { CHANNEL_FORMATS, NotificationChannelService } from "./notification-channel.service.js";
import { NotificationService } from "./notification.service.js";

/**
 * Notification center REST API (Phase 3.0 + Phase 4.0 backlog #4 target).
 *
 *   GET    /api/notifications          — recent notifications, newest first
 *                                        (?limit ≤100, ?kind=engine.task.failed,
 *                                         ?unread=true) → { items, unreadCount }
 *   GET    /api/notifications/unread-count → { unreadCount } (sidebar badge)
 *   POST   /api/notifications/read-all → mark every visible notification read
 *   POST   /api/notifications/:id/read → mark one notification read
 *   DELETE /api/notifications/:id      → dismiss (delete) one notification
 *
 * Per-user targeting (BG4): list + unread-count are scoped to the caller —
 * they see GLOBAL notifications (recipientId null) plus ones targeted at them
 * (recipientId = their id). The feed is written by platform events +
 * user-targeted record() calls.
 */
@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly channels: NotificationChannelService,
  ) {}

  @Get()
  @ApiOkResponse({ description: "Recent notifications (global + the caller's), plus the total unread count." })
  list(
    @CurrentUser() user: AuthPrincipal | undefined,
    @Query("limit") limit?: string,
    @Query("kind") kind?: string,
    @Query("unread") unread?: string,
  ) {
    const parsed = limit ? Number.parseInt(limit, 10) : undefined;
    const unreadOnly = unread === "true" || unread === "1";
    return this.notifications.list(user?.id ?? null, Number.isFinite(parsed) ? parsed : undefined, kind || undefined, unreadOnly);
  }

  @Get("unread-count")
  @ApiOkResponse({ description: "Total unread notifications for the caller (global + own)." })
  async unreadCount(@CurrentUser() user: AuthPrincipal | undefined) {
    const unreadCount = await this.notifications.unreadCount(user?.id ?? null);
    return { unreadCount };
  }

  @Post("read-all")
  @ApiOkResponse({ description: "Marks every notification read; resolves the number flipped." })
  async readAll() {
    const updated = await this.notifications.markAllRead();
    return { updated };
  }

  @Post(":id/read")
  @ApiOkResponse({ description: "Marks one notification read." })
  async markRead(@Param("id") id: string) {
    const row = await this.notifications.markRead(id);
    if (!row) throw new NotFoundException(`Notification ${id} not found`);
    return { id: row.id, read: true };
  }

  @Delete(":id")
  @ApiOkResponse({ description: "Dismisses (deletes) one notification." })
  async dismiss(@Param("id") id: string) {
    const row = await this.notifications.dismiss(id);
    if (!row) throw new NotFoundException(`Notification ${id} not found`);
    return { id: row.id, dismissed: true };
  }

  // ── Outbound channels (notification channels round) ─────────────────────
  // Webhook delivery for the event feed: configure a generic/Slack/Discord/
  // Teams webhook URL, pick which kinds it receives (empty = all), enable it,
  // and every matching event is POSTed (fire-and-forget).

  @Get("channels")
  @ApiOkResponse({ description: "Configured outbound notification channels." })
  async listChannels() {
    const channels = await this.channels.list();
    return { channels };
  }

  @Post("channels")
  @ApiOkResponse({ description: "Create or update an outbound notification channel." })
  async upsertChannel(@Body() body: Record<string, unknown>) {
    const name = typeof body.name === "string" ? body.name : "";
    const type = body.type === "smtp" ? "smtp" : "webhook";
    const url = typeof body.url === "string" ? body.url : "";
    const to = typeof body.to === "string" ? body.to : "";
    const from = typeof body.from === "string" ? body.from : undefined;
    if (!name.trim()) throw new BadRequestException("Channel name is required.");
    if (type === "smtp") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim())) {
        throw new BadRequestException("SMTP channels need a valid recipient email in `to`.");
      }
    } else {
      if (!/^https?:\/\//.test(url.trim())) throw new BadRequestException("Channel url must start with http:// or https://.");
      const format = typeof body.format === "string" ? body.format : "generic";
      if (!(CHANNEL_FORMATS as readonly string[]).includes(format)) {
        throw new BadRequestException(`Channel format must be one of: ${CHANNEL_FORMATS.join(", ")}.`);
      }
    }
    const channel = await this.channels.upsert({
      id: typeof body.id === "string" ? body.id : undefined,
      name,
      type,
      ...(type === "smtp" ? { to, from } : { url, format: typeof body.format === "string" ? body.format : "generic" }),
      kinds: Array.isArray(body.kinds) ? body.kinds.filter((k): k is string => typeof k === "string") : [],
      enabled: body.enabled === undefined ? true : body.enabled === true,
    });
    if (!channel) throw new BadRequestException("Cannot persist channels: no database is available.");
    return { channel };
  }

  @Delete("channels/:id")
  @ApiOkResponse({ description: "Removes an outbound notification channel." })
  async removeChannel(@Param("id") id: string) {
    const removed = await this.channels.remove(id);
    if (!removed) throw new NotFoundException(`Channel ${id} not found`);
    return { id, removed: true };
  }

  @Post("channels/:id/test")
  @ApiOkResponse({ description: "Sends a test message through one channel." })
  async testChannel(@Param("id") id: string) {
    const channel = (await this.channels.list()).find((c) => c.id === id);
    if (!channel) throw new NotFoundException(`Channel ${id} not found`);
    return this.channels.sendTest(channel);
  }
}
