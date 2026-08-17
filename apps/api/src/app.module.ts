import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuditModule } from "./core/audit/audit.module.js";
import { AuthModule } from "./core/auth/auth.module.js";
import { DatabaseModule } from "./core/database/database.module.js";
import { EngineModule } from "./core/engine/engine.module.js";
import { EventsModule } from "./core/events/events.module.js";
import { FederationModule } from "./core/federation/federation.module.js";
import { HealthModule } from "./core/health/health.module.js";
import { LoggingModule } from "./core/logging/logging.module.js";
import { MemoryModule } from "./core/memory/memory.module.js";
import { NotificationsModule } from "./core/notifications/notifications.module.js";
import { ObservabilityModule } from "./core/observability/observability.module.js";
import { PluginsModule } from "./core/plugins/plugins.module.js";
import { WorkflowsModule } from "./core/workflows/workflows.module.js";
import { RbacModule } from "./core/rbac/rbac.module.js";
import { SettingsModule } from "./core/settings/settings.module.js";
import { TeamsModule } from "./core/teams/teams.module.js";
import { McpModule } from "./core/mcp/mcp.module.js";
import { SkillsModule } from "./core/skills/skills.module.js";
import { MeshModule } from "./core/mesh/mesh.module.js";
import { ReportsModule } from "./core/reports/reports.module.js";
import { AiControllerModule } from "./core/ai-controller/ai-controller.module.js";

/**
 * The core platform module. It stays deliberately small: config, logging,
 * the data layer, settings/feature-flags, the event bus, health, auth/RBAC/
 * audit, and the plugin subsystem. Everything else arrives as a plugin —
 * this is the "core provides the frame, plugins provide the features"
 * principle.
 *
 * Import order: logging and the database come first (everything else can
 * log, and settings/auth depend on the database); settings and events are
 * independent of each other; RBAC and audit are global and have no
 * dependencies of their own, so they're listed just before auth (which
 * injects both `RolesService` and `AuditService`); health and plugins come
 * last since they observe/drive the rest.
 *
 * `AuthModule` registers `JwtAuthGuard` as the global `APP_GUARD` — every
 * route requires a bearer token by default from here on, except routes
 * marked `@Public()`: today `POST /api/auth/login`, `GET /api/health`,
 * `GET /api/identity`, and the plugin read API (`GET /api/plugins`,
 * `GET /api/plugins/:id`).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    LoggingModule,
    DatabaseModule,
    SettingsModule,
    EventsModule,
    RbacModule,
    AuditModule,
    AuthModule,
    FederationModule,
    MemoryModule,
    HealthModule,
    PluginsModule,
    WorkflowsModule,
    EngineModule,
    NotificationsModule,
    TeamsModule,
    McpModule,
    SkillsModule,
    MeshModule,
    ReportsModule,
    AiControllerModule,
    ObservabilityModule,
  ],
})
export class AppModule {}
