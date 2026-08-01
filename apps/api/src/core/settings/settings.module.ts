import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { FeatureFlagService } from "./feature-flag.service.js";
import { PluginConfigFactory } from "./plugin-config.factory.js";
import { SettingsService } from "./settings.service.js";

/**
 * Settings + feature flags, backed by Prisma with a manifest-default
 * fallback when there's no database. Global so any core module can inject
 * `SettingsService`/`FeatureFlagService`/`PluginConfigFactory` directly.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [SettingsService, FeatureFlagService, PluginConfigFactory],
  exports: [SettingsService, FeatureFlagService, PluginConfigFactory],
})
export class SettingsModule {}
