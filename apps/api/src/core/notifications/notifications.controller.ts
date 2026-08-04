import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CHANNEL_FORMATS, NotificationChannelService } from "./notification-channel.service.js";
import { NotificationService } from "./notification.service.js";

/**
 * Notification center REST API (Phase 3.0).
 *
 *   GET    /api/notifications          — recent notifications, newest first
 *                                        (?limit ≤100, ?kind=engine.task.failed,
 *                                         ?unread=true) → { items, unreadCount }
 *   GET    /api/notifications/unread-count → { unreadCount } (sidebar badge)
 *   POST   /api/notifications/read-all → mark every notification read
 *   POST   /api/notifications/:id/read → mark one notification read
 *   DELETE /api/notifications/:id      → dismiss (delete) one notification
 *
 * The feed is written exclusively by platform events (see NotificationService);
 * these routes are read / mark-read / dismiss only. The global JwtAuthGuard
 * applies (any authenticated user, same posture as the engine routes) — the
 * feed is system-wide today; per-user targeting is a team-spaces follow-up.
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
  @ApiOkResponse({ description: "Recent notifications, newest first, plus the total unread count." })
  list(
    @Query("limit") limit?: string,
    @Query("kind") kind?: string,
    @Query("unread") unread?: string,
  ) {
    const parsed = limit ? Number.parseInt(limit, 10) : undefined;
    const unreadOnly = unread === "true" || unread === "1";
    return this.notifications.list(Number.isFinite(parsed) ? parsed : undefined, kind || undefined, unreadOnly);
  }

  @Get("unread-count")
  @ApiOkResponse({ description: "Total unread notifications (powers the portal sidebar badge)." })
  async unreadCount() {
    const unreadCount = await this.notifications.unreadCount();
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
    const url = typeof body.url === "string" ? body.url : "";
    if (!name.trim()) throw new BadRequestException("Channel name is required.");
    if (!/^https?:\/\//.test(url.trim())) throw new BadRequestException("Channel url must start with http:// or https://.");
    const format = typeof body.format === "string" ? body.format : "generic";
    if (!(CHANNEL_FORMATS as readonly string[]).includes(format)) {
      throw new BadRequestException(`Channel format must be one of: ${CHANNEL_FORMATS.join(", ")}.`);
    }
    const channel = await this.channels.upsert({
      id: typeof body.id === "string" ? body.id : undefined,
      name,
      type: "webhook",
      url,
      format,
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
