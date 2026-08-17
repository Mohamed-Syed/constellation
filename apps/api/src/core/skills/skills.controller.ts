import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CorePermissions } from "@constellation/plugin-sdk";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { PermissionsGuard } from "../rbac/permissions.guard.js";
import { SkillService, type SkillWithState } from "./skill.service.js";

/**
 * Skill marketplace (Phase 4.0 4.4) — the "app store" for agent skills.
 * GET lists the catalog with per-skill install state; install/uninstall/toggle
 * are admin actions backed by the scheduler (`skill:<id>` schedules).
 */
@ApiTags("skills")
@Controller("skills")
export class SkillsController {
  constructor(private readonly skills: SkillService) {}

  @Get()
  @ApiOkResponse({ description: "Skill catalog with install state." })
  list(): Promise<SkillWithState[]> {
    return this.skills.list();
  }

  @Post(":id/install")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.PLUGIN_MANAGE)
  @ApiOkResponse({ description: "Installs the skill as a cron scheduled task." })
  install(@Param("id") id: string): Promise<{ ok: boolean; skill: SkillWithState | null }> {
    return this.skills.install(id).then((skill) => ({ ok: skill !== null, skill }));
  }

  @Post(":id/uninstall")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.PLUGIN_MANAGE)
  @ApiOkResponse({ description: "Removes the skill's scheduled task." })
  uninstall(@Param("id") id: string): Promise<{ ok: boolean }> {
    return this.skills.uninstall(id).then((ok) => ({ ok }));
  }

  @Post(":id/toggle")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.PLUGIN_MANAGE)
  @ApiOkResponse({ description: "Enables or disables the installed skill." })
  toggle(@Param("id") id: string): Promise<{ ok: boolean; skill: SkillWithState | null }> {
    return this.skills.toggle(id).then((skill) => ({ ok: skill !== null, skill }));
  }
}
