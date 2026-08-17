import { Global, Module } from "@nestjs/common";
import { AuditController } from "./audit.controller.js";
import { AuditService } from "./audit.service.js";

/**
 * Audit trail. Global so `AuditService.record(...)` is injectable from any
 * module — including ones outside this workstream (e.g. another module's plugin
 * enable/disable mutations, wired at integration) — without importing this
 * module directly.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
