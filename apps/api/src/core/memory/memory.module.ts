import { Global, Module } from "@nestjs/common";
import { BrainController } from "./brain.controller.js";
import { BrainService } from "./brain.service.js";
import { GraphifyAdapter } from "./graphify.adapter.js";

/**
 * `core/memory` — the brain (docs/BRAIN.md).
 *
 * `@Global()` for the same reason the other core service modules are: the
 * plugin subsystem hands a `memory` capability to plugin contexts, and future
 * consumers (health, an agent orchestrator) should not each have to import
 * this module. The module has NO dependencies of its own — it reads the
 * filesystem and (optionally) an MCP endpoint — so it can be mounted anywhere
 * in the import order and is safe to boot with no brain present.
 */
@Global()
@Module({
  controllers: [BrainController],
  providers: [GraphifyAdapter, BrainService],
  exports: [BrainService],
})
export class MemoryModule {}
