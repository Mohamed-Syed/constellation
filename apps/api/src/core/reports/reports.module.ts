import { Module } from "@nestjs/common";
import { ReportsController } from "./reports.controller.js";
import { ReportService } from "./report.service.js";
import { NotificationsModule } from "../notifications/notifications.module.js";

/**
 * Scheduled report delivery (Phase 4.0 backlog #2). ReportService generates
 * the audit/compliance PDF and delivers it as a durable notification + channel
 * dispatch; the controller exposes admin-gated triggers + a list of generated
 * reports. Imports NotificationsModule so the REAL NotificationService and
 * NotificationChannelService are injected (without it, @Optional() would
 * resolve them to undefined and delivery would silently no-op — verified live).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ReportsController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportsModule {}
