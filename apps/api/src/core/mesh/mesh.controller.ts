import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CorePermissions } from "@constellation/plugin-sdk";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { PermissionsGuard } from "../rbac/permissions.guard.js";
import { RegisterPeerDto } from "./dto/register-peer.dto.js";
import { MeshService, type MeshPeerView, type MeshTopologyView } from "./mesh.service.js";

/**
 * Federated agent mesh (Phase 4.0 4.6) — registry + health prober + topology.
 * The whole surface is admin-gated (`core:mesh:manage`): the fleet's names and
 * base URLs are operational data. Cross-instance task ROUTING is the explicit
 * next step and deliberately not exposed here yet.
 */
@ApiTags("mesh")
@Controller("mesh")
// Class-level guard, matching every sibling admin controller (audit,
// federation, brain, skills): the WHOLE surface is admin-gated, so the guard
// is hoisted once; @RequirePermissions stays per-route (that's the norm).
@UseGuards(PermissionsGuard)
export class MeshController {
  constructor(private readonly mesh: MeshService) {}

  @Get("topology")
  @RequirePermissions(CorePermissions.MESH_MANAGE)
  @ApiOkResponse({ description: "Every registered peer + per-status counts." })
  topology(): Promise<MeshTopologyView> {
    return this.mesh.topology();
  }

  @Post("peers")
  @RequirePermissions(CorePermissions.MESH_MANAGE)
  @ApiOkResponse({ description: "Registers a peer and probes it immediately." })
  register(@Body() dto: RegisterPeerDto): Promise<{ peer: MeshPeerView }> {
    return this.mesh.register(dto).then((result) => {
      if (result.ok) return { peer: result.peer };
      // Discriminated reasons map to honest HTTP statuses so the portal can
      // toast the exact failure instead of guessing.
      switch (result.error) {
        case "duplicate":
          throw new ConflictException("A peer with that name already exists.");
        case "invalid":
          throw new BadRequestException("Name and base URL are required.");
        case "no-db":
          throw new ServiceUnavailableException("Mesh registry unavailable: no database configured.");
        default:
          throw new InternalServerErrorException("Peer registration failed.");
      }
    });
  }

  @Post("peers/:id/probe")
  @RequirePermissions(CorePermissions.MESH_MANAGE)
  @ApiOkResponse({ description: "Re-probes one peer's /api/health on demand." })
  probe(@Param("id") id: string): Promise<{ peer: MeshPeerView | null }> {
    return this.mesh.probe(id).then((peer) => ({ peer }));
  }

  /**
   * Phase 4.0 backlog #6 — CROSS-INSTANCE TASK ROUTING.
   * Forward a task to the peer (enqueued there via its mesh/forward receiver,
   * gated by the shared MESH_ROUTE_API_KEY). Admin-gated like the rest of the
   * mesh surface.
   */
  @Post("peers/:id/route")
  @RequirePermissions(CorePermissions.MESH_MANAGE)
  @ApiOkResponse({ description: "Forwards a task to the peer's own engine." })
  async route(@Param("id") id: string, @Body() body: { title?: string; prompt?: string; model?: string; maxSteps?: number }) {
    const title = typeof body.title === "string" ? body.title : "";
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!title.trim() || !prompt.trim()) throw new BadRequestException("title and prompt are required.");
    const result = await this.mesh.routeTask(id, {
      title: title.trim(),
      prompt: prompt.trim(),
      model: typeof body.model === "string" ? body.model : undefined,
      maxSteps: typeof body.maxSteps === "number" ? body.maxSteps : undefined,
    });
    if (!result.ok) {
      if (result.error === "peer-not-found") throw new NotFoundException(`Peer "${id}" not found`);
      throw new ServiceUnavailableException(result.error);
    }
    return { peerId: id, taskId: result.taskId, status: result.status };
  }

  @Delete("peers/:id")
  @RequirePermissions(CorePermissions.MESH_MANAGE)
  @ApiOkResponse({ description: "Removes a peer from the mesh." })
  remove(@Param("id") id: string): Promise<{ ok: boolean }> {
    return this.mesh.remove(id).then((ok) => ({ ok }));
  }
}
