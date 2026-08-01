import { Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CorePermissions, type LoadedPlugin } from "@constellation/plugin-sdk";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Public } from "../auth/public.decorator.js";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { AuditService } from "../audit/audit.service.js";
import { PermissionsGuard } from "../rbac/permissions.guard.js";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { PluginLifecycleService } from "./plugin-lifecycle.service.js";
import { PluginRegistryService } from "./plugin-registry.service.js";

/**
 * Read API for the plugin registry, plus the enable/disable mutation routes.
 *
 * Auth posture (wired by the orchestrator at P2 integration):
 * - The READ routes are `@Public()` — the module catalog is non-sensitive
 *   metadata and the portal renders its nav from it (incl. server-side). Harden
 *   to authenticated-only + client-token fetch in a later pass if desired.
 * - The MUTATION routes require `core:plugin:manage` (`PermissionsGuard` +
 *   `@RequirePermissions`), on top of the global `JwtAuthGuard`, and every
 *   transition is written to the audit log.
 */
@ApiTags("plugins")
@Controller("plugins")
export class PluginsController {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly lifecycle: PluginLifecycleService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get()
  @ApiOkResponse({ description: "List every loaded plugin with its state." })
  list() {
    return this.registry.all().map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      state: p.state,
      permissions: p.manifest.permissions,
      navigation: p.manifest.navigation,
      error: p.error,
      health: p.health ?? null,
      healthCheckedAt: p.healthCheckedAt ?? null,
      /** Agent-plane tool count; the full declarations live on the detail route. */
      toolCount: p.manifest.tools.length,
    }));
  }

  @Public()
  @Get(":id")
  @ApiOkResponse({ description: "Full manifest + state for one plugin." })
  get(@Param("id") id: string) {
    return this.toDetail(this.getOrThrow(id));
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.PLUGIN_MANAGE)
  @Post(":id/enable")
  @ApiOkResponse({ description: "Enable a plugin; returns the updated plugin summary." })
  async enable(@Param("id") id: string, @CurrentUser() user?: AuthPrincipal) {
    this.getOrThrow(id); // 404 before attempting the transition
    await this.lifecycle.enable(id);
    await this.audit.record(user?.id ?? null, "plugin.enable", id);
    return this.toDetail(this.getOrThrow(id));
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.PLUGIN_MANAGE)
  @Post(":id/disable")
  @ApiOkResponse({ description: "Disable a plugin; returns the updated plugin summary." })
  async disable(@Param("id") id: string, @CurrentUser() user?: AuthPrincipal) {
    this.getOrThrow(id); // 404 before attempting the transition
    await this.lifecycle.disable(id);
    await this.audit.record(user?.id ?? null, "plugin.disable", id);
    return this.toDetail(this.getOrThrow(id));
  }

  private getOrThrow(id: string): LoadedPlugin {
    const p = this.registry.get(id);
    if (!p) throw new NotFoundException(`No plugin "${id}"`);
    return p;
  }

  /** Same shape as `GET /api/plugins/:id` — shared by the read route and both mutation routes. */
  private toDetail(p: LoadedPlugin) {
    return {
      ...p.manifest,
      state: p.state,
      error: p.error,
      health: p.health ?? null,
      healthCheckedAt: p.healthCheckedAt ?? null,
      /**
       * Declared agent-plane tools, spread explicitly (not just via
       * `...p.manifest`) so this stays a deliberate, documented part of the
       * read API rather than an accident of manifest shape. Read-only:
       * invoking a tool is a separate, permission-checked route (later round).
       */
      tools: p.manifest.tools,
      /** True when the loaded runtime actually implements the invokeTool seam. */
      supportsToolInvocation: typeof p.runtime.invokeTool === "function",
    };
  }
}
