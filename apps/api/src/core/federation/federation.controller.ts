import { Controller, Get, NotFoundException, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CorePermissions } from "@constellation/plugin-sdk";
import { PermissionsGuard } from "../rbac/permissions.guard.js";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { FederationRegistryService, type FederatedModule } from "./federation-registry.service.js";

/** The browser-safe view of a federated module. */
export interface FederatedModuleDto {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  path: string;
  embeddable: boolean;
  sso: boolean;
  display: "tile" | "hidden";
  requiresPermissions: string[];
}

/**
 * Read API for the P3 federation registry — the portal calls this to render
 * its tiles for Grafana / Open WebUI / Langflow / etc.
 *
 * AUTHENTICATED (deliberately NOT `@Public`): unlike the plugin read API,
 * this describes internal tooling and which permissions gate each one, so it
 * is reconnaissance-useful to an anonymous caller. The global `JwtAuthGuard`
 * therefore applies.
 *
 * `upstream` (the compose-network address) is stripped from every response —
 * it's for the reverse proxy, not for browsers.
 */
@ApiTags("federation")
@ApiBearerAuth()
@Controller("federation")
@UseGuards(PermissionsGuard)
export class FederationController {
  constructor(private readonly registry: FederationRegistryService) {}

  @Get("modules")
  @ApiOperation({ summary: "List enabled federated modules (portal tiles)." })
  list(): FederatedModuleDto[] {
    return this.registry.enabled().map(toDto);
  }

  @Get("modules/:id")
  @ApiOperation({ summary: "Get a single federated module by id." })
  findOne(@Param("id") id: string): FederatedModuleDto {
    const found = this.registry.findById(id);
    if (!found || !found.enabled) throw new NotFoundException(`No enabled federated module "${id}".`);
    return toDto(found);
  }

  @Get("status")
  @RequirePermissions(CorePermissions.PLATFORM_ADMIN)
  @ApiOperation({ summary: "Registry diagnostics (admin): counts and any parse error." })
  status(): { total: number; enabled: number; tiles: number; error?: string } {
    return this.registry.status();
  }
}

function toDto(m: FederatedModule): FederatedModuleDto {
  // Explicit allow-list rather than destructuring-omit, so a future field
  // added to FederatedModule can never leak by accident.
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    category: m.category,
    icon: m.icon,
    path: m.path,
    embeddable: m.embeddable,
    sso: m.sso,
    display: m.display,
    requiresPermissions: m.requiresPermissions,
  };
}
