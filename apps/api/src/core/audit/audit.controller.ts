import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CorePermissions } from "@constellation/plugin-sdk";
import { PermissionsGuard } from "../rbac/permissions.guard.js";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { AuditService } from "./audit.service.js";

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
}
