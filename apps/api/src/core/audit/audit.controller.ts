import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CorePermissions } from "@constellation/plugin-sdk";
import { PermissionsGuard } from "../rbac/permissions.guard.js";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { AuditService, auditToCsv } from "./audit.service.js";
import { auditToPdf } from "./pdf-export.js";

/** `GET /api/audit` — admin-only (requires `core:audit:read`, which `platform:admin` implies). */
@ApiTags("audit")
@ApiBearerAuth()
@Controller("audit")
@UseGuards(PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(CorePermissions.AUDIT_READ)
  @ApiOkResponse({ description: "Recent audit log entries, newest first." })
  list(@Query("limit") limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : undefined;
    return this.audit.list(Number.isFinite(parsed) ? parsed : undefined);
  }

  /**
   * Phase 4.0 — compliance export: the audit log as CSV (RFC-4180-style
   * quoting), optionally filtered by actor/action. Downloads as
   * `constellation-audit-<ts>.csv`.
   */
  @Get("export")
  @RequirePermissions(CorePermissions.AUDIT_READ)
  @ApiOkResponse({ description: "Audit log as a downloadable CSV (compliance export)." })
  async exportCsv(
    @Res() res: Response,
    @Query("actor") actor?: string,
    @Query("action") action?: string,
    @Query("limit") limit?: string,
    @Query("format") format?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : 1000;
    const entries = await this.audit.listForExport({
      limit: Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 1000) : 1000,
      actor: actor || undefined,
      action: action || undefined,
    });
    if (format === "pdf") {
      const pdf = auditToPdf(entries);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="constellation-audit-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(pdf);
      return;
    }
    const csv = auditToCsv(entries);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="constellation-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }
}
