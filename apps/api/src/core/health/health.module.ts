import { Module } from "@nestjs/common";
import { PluginsModule } from "../plugins/plugins.module.js";
import { HealthController } from "./health.controller.js";
import { IdentityController } from "./identity.controller.js";

@Module({
  imports: [PluginsModule],
  controllers: [HealthController, IdentityController],
})
export class HealthModule {}
