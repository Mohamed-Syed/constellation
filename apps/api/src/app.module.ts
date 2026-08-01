import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./core/database/database.module.js";
import { EventsModule } from "./core/events/events.module.js";
import { HealthModule } from "./core/health/health.module.js";
import { LoggingModule } from "./core/logging/logging.module.js";
import { PluginsModule } from "./core/plugins/plugins.module.js";
import { SettingsModule } from "./core/settings/settings.module.js";

/**
 * The core platform module. It stays deliberately small: config, logging,
 * the data layer, settings/feature-flags, the event bus, health, and the
 * plugin subsystem. Everything else arrives as a plugin — this is the
 * "core provides the frame, plugins provide the features" principle.
 *
 * Import order: logging and the database come first (everything else can
 * log, and settings depends on the database); settings and events are
 * independent of each other; health and plugins come last since they
 * observe/drive the rest.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    LoggingModule,
    DatabaseModule,
    SettingsModule,
    EventsModule,
    HealthModule,
    PluginsModule,
  ],
})
export class AppModule {}
