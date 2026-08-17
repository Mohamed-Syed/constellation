import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CorePermissions } from "@constellation/plugin-sdk";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { PermissionsGuard } from "../rbac/permissions.guard.js";
import { ReportService, type GeneratedReport } from "./report.service.js";

/**
 * Phase 4.0 backlog #2 — SCHEDULED REPORT DELIVERY.
 * Admin-gated report generation + delivery. The whole surface is admin-only
 * (compliance reports carry audit data). A cron or the Agentic Controller can
 * POST /api/reports to produce + deliver a fresh audit PDF on a schedule.
 */
@ApiTags("reports")
@Controller("reports")
@UseGuards(PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportService) {}

  /** Generate + optionally deliver a fresh audit/compliance report (optionally targeted to one user). */
  @Post()
  @RequirePermissions(CorePermissions.AUDIT_READ)
  @ApiOkResponse({ description: "Audit/compliance PDF report (generated, optionally delivered)." })
  generate(@Body() dto: { actor?: string; action?: string; title?: string; deliver?: boolean; recipientId?: string | null }): Promise<GeneratedReport> {
    return this.reports.generate({
      actor: dto.actor,
      action: dto.action,
      title: dto.title,
      deliver: dto.deliver ?? true,
      recipientId: dto.recipientId ?? null,
    });
  }

  /** List previously generated report files. */
  @Get()
  @RequirePermissions(CorePermissions.AUDIT_READ)
  @ApiOkResponse({ description: "Previously generated report files." })
  async list() {
    const items = await this.reports.list(20);
    return { items, total: items.length };
  }
}
