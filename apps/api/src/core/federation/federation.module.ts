import { Global, Module } from "@nestjs/common";
import { FederationController } from "./federation.controller.js";
import { FederationRegistryService } from "./federation-registry.service.js";

/**
 * P3 portal federation: the declarative `config/modules.yaml` registry of
 * heavyweight tools the platform proxies rather than reimplements (C5/C7).
 *
 * `@Global()` so the health controller (and anything else) can report
 * registry status without importing this module explicitly — the same
 * pattern the other core service modules use.
 */
@Global()
@Module({
  controllers: [FederationController],
  providers: [FederationRegistryService],
  exports: [FederationRegistryService],
})
export class FederationModule {}
