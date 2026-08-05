import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { TeamService } from "./team.service.js";

/**
 * Team spaces REST API (Phase 3.0).
 *
 *   POST   /api/teams                       { name } → creates org + team + owner membership
 *   GET    /api/teams                       → my teams [{ id, name, orgId, role }]
 *   GET    /api/teams/:id                   → team + members (members + platform admins)
 *   POST   /api/teams/:id/members           { email, role? } → add member (owner/admin only)
 *   DELETE /api/teams/:id/members/:userId   → remove member (owner/admin only; owner protected)
 *
 * Global JwtAuthGuard applies. Membership checks use the caller's team role
 * (owner/admin manage; members read). Platform admins pass every check.
 */
@ApiTags("teams")
@ApiBearerAuth()
@Controller("teams")
export class TeamsController {
  constructor(private readonly teams: TeamService) {}

  @Post()
  @ApiOkResponse({ description: "Create an organization + team; the caller becomes owner." })
  async create(@Body() body: { name?: unknown }, @CurrentUser() user?: AuthPrincipal) {
    const name = typeof body.name === "string" ? body.name : "";
    if (!name.trim()) throw new NotFoundException("A team name is required.");
    const team = await this.teams.create(user?.id ?? null, name);
    if (!team) throw new NotFoundException("Could not create the team (no database, or no actor).");
    return { team };
  }

  @Get()
  @ApiOkResponse({ description: "The caller's teams with their role in each." })
  async mine(@CurrentUser() user?: AuthPrincipal) {
    const teams = await this.teams.listForUser(user?.id ?? null);
    return { teams };
  }

  @Get(":id")
  @ApiOkResponse({ description: "One team + its members." })
  async get(@Param("id") id: string, @CurrentUser() user?: AuthPrincipal) {
    const [team, member, admin] = await Promise.all([
      this.teams.detail(id),
      this.teams.isMember(user?.id ?? null, id),
      Promise.resolve(user?.permissions?.includes("platform:admin") ?? false),
    ]);
    if (!team) throw new NotFoundException(`Team "${id}" not found`);
    if (!member && !admin) throw new ForbiddenException("You are not a member of this team.");
    return team;
  }

  @Post(":id/members")
  @ApiOkResponse({ description: "Add a member by email (owner/admin only)." })
  async addMember(
    @Param("id") id: string,
    @Body() body: { email?: unknown; role?: unknown },
    @CurrentUser() user?: AuthPrincipal,
  ) {
    await this.assertManager(user, id);
    const email = typeof body.email === "string" ? body.email : "";
    if (!email.trim()) throw new NotFoundException("A member email is required.");
    const role = typeof body.role === "string" ? body.role : "member";
    const member = await this.teams.addMember(id, email, role);
    if (!member) throw new NotFoundException(`No user with email "${email}" exists.`);
    return { member };
  }

  @Delete(":id/members/:userId")
  @ApiOkResponse({ description: "Remove a member (owner/admin only; the owner is protected)." })
  async removeMember(@Param("id") id: string, @Param("userId") userId: string, @CurrentUser() user?: AuthPrincipal) {
    await this.assertManager(user, id);
    const removed = await this.teams.removeMember(id, userId);
    if (!removed) throw new NotFoundException(`Membership for ${userId} not found (or the owner is protected).`);
    return { id, userId, removed: true };
  }

  private async assertManager(user: AuthPrincipal | undefined, teamId: string): Promise<void> {
    if (user?.permissions?.includes("platform:admin")) return;
    const can = await this.teams.canManage(user?.id ?? null, teamId);
    if (!can) throw new ForbiddenException("Team member management requires the owner or an admin role.");
  }
}
