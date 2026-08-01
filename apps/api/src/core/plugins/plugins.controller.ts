import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CorePermissions, type LoadedPlugin } from "@constellation/plugin-sdk";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Public } from "../auth/public.decorator.js";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { AuditService } from "../audit/audit.service.js";
import { PermissionsGuard } from "../rbac/permissions.guard.js";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { PluginLifecycleService } from "./plugin-lifecycle.service.js";
import { InvokeToolDto } from "./dto/invoke-tool.dto.js";
import { PluginRegistryService } from "./plugin-registry.service.js";
import { PluginToolService } from "./plugin-tool.service.js";

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
    private readonly tools: PluginToolService,
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

  /**
   * AGENT PLANE: invoke a tool a plugin declares in its manifest.
   *
   * Two-layer authorization, deliberately:
   *  1. Route level — `core:plugin:manage`, same coarse gate as enable/disable.
   *  2. Per-tool — `PluginToolService` additionally requires the individual
   *     tool's own `permission`, so tools are not all equally privileged just
   *     because a caller can reach this route.
   *
   * Every attempt is audited, **including denials and failures** — for an
   * endpoint that runs plugin code on demand, the denied calls are the ones
   * worth having a record of. The audit write happens before the response and
   * is itself no-op-with-warn when there's no database.
   *
   * A tool returning `{ ok: false }` is a COMPLETED call, not an HTTP error:
   * it responds 200 with the envelope so the agent can read the reason. Only
   * pre-dispatch rejections map to 4xx.
   */
  @UseGuards(PermissionsGuard)
  @RequirePermissions(CorePermissions.PLUGIN_MANAGE)
  @Post(":id/invoke")
  @ApiOkResponse({ description: "Invoke a declared agent-plane tool on a plugin." })
  async invoke(
    @Param("id") id: string,
    @Body() dto: InvokeToolDto,
    @CurrentUser() user?: AuthPrincipal,
  ) {
    const actor = user?.id ?? null;
    const args = dto.args ?? {};
    // `platform:admin` for an unauthenticated caller is impossible here (the
    // global JwtAuthGuard runs first); the fallback only matters for tests.
    const permissions = user?.permissions ?? [];

    const invocation = await this.tools.invoke(id, dto.tool, args, permissions);

    if (invocation.outcome === "rejected") {
      await this.audit.record(actor, "plugin.tool.denied", id, {
        tool: dto.tool,
        reason: invocation.reason,
        requiredPermission: invocation.requiredPermission,
      });
      throw rejectionToHttp(invocation.reason, invocation.message);
    }

    await this.audit.record(actor, "plugin.tool.invoke", id, {
      tool: dto.tool,
      ok: invocation.result.ok,
      durationMs: invocation.durationMs,
      // Deliberately NOT logging args or result payloads — they can carry
      // credentials, PII, or page content. Names and outcomes only.
      error: invocation.result.ok ? undefined : invocation.result.error?.slice(0, 500),
    });

    return {
      pluginId: id,
      tool: dto.tool,
      durationMs: invocation.durationMs,
      ...invocation.result,
    };
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

/**
 * Maps a pre-dispatch rejection to the right HTTP status. Kept as a free
 * function so `PluginToolService` stays transport-agnostic.
 */
function rejectionToHttp(reason: string, message: string): Error {
  switch (reason) {
    case "plugin-not-found":
    case "tool-not-declared":
      return new NotFoundException(message);
    case "forbidden":
      return new ForbiddenException(message);
    case "plugin-not-enabled":
      return new ConflictException(message);
    default:
      return new BadRequestException(message);
  }
}
