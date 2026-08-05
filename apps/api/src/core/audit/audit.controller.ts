import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CorePermissions } from "@constellation/plugin-sdk";
import { PermissionsGuard } from "../rbac/permissions.guard.js";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { AuditService, auditToCsv } from "./audit.service.js";

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
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const rows = await this.audit.listForExport({
      actor,
      action,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
    const csv = auditToCsv(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="constellation-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.csv"`,
    );
    res.send(csv);
  }
}
