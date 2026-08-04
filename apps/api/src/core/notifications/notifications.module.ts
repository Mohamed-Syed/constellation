import { Module } from "@nestjs/common";
import { NotificationChannelService } from "./notification-channel.service.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationService } from "./notification.service.js";

/**
 * Notification center (Phase 3.0). PrismaService and EventBusService are
 * provided globally (DatabaseModule / EventsModule), so this module only
 * declares its own services + controller. The service listens on the platform
 * EventBus and persists events into the durable `notifications` table; the
 * channel service delivers matching events to configured webhooks.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationService, NotificationChannelService],
  exports: [NotificationService, NotificationChannelService],
})
export class NotificationsModule {}
