import { Module } from "@nestjs/common";
import { TeamService } from "./team.service.js";
import { TeamsController } from "./teams.controller.js";

/**
 * Team spaces (Phase 3.0). PrismaService is global; this module only declares
 * the team service + controller. Exports TeamService so the engine controller
 * can enforce team scoping on tasks and AuthService can surface memberships.
 */
@Module({
  controllers: [TeamsController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamsModule {}
