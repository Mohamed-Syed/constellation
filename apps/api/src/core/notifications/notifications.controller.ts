import { Controller, Delete, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
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
  constructor(private readonly notifications: NotificationService) {}

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
}
