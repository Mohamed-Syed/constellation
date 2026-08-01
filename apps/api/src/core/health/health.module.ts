import { Module } from "@nestjs/common";
import { PluginsModule } from "../plugins/plugins.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  imports: [PluginsModule],
  controllers: [HealthController],
})
export class HealthModule {}
