import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationService } from "./notification.service.js";

/**
 * Notification center (Phase 3.0). PrismaService and EventBusService are
 * provided globally (DatabaseModule / EventsModule), so this module only
 * declares its own service + controller. The service listens on the platform
 * EventBus and persists events into the durable `notifications` table.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
