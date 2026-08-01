import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./core/health/health.module.js";
import { PluginsModule } from "./core/plugins/plugins.module.js";

/**
 * The core platform module. It stays deliberately small: config, health, and
 * the plugin subsystem. Everything else arrives as a plugin — this is the
 * "core provides the frame, plugins provide the features" principle.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    HealthModule,
    PluginsModule,
  ],
})
export class AppModule {}
