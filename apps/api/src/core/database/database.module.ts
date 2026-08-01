import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

/**
 * The platform's `core`-schema data layer. Global so every other core
 * module (settings, plugins, health, …) can inject `PrismaService` without
 * re-importing this module. Per-plugin schemas are NOT modeled here — each
 * plugin owns its own `schema.prisma` + migrations; see `README.md`.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
