import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CorePermissions } from "@constellation/plugin-sdk";
import type { GraphJson, MemoryAnswer, MemoryStats } from "@constellation/plugin-sdk";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { PermissionsGuard } from "../rbac/permissions.guard.js";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { BrainService } from "./brain.service.js";
import { QueryDto, RememberDto } from "./dto/brain.dto.js";

/**
 * The brain REST surface (docs/BRAIN.md §5).
 *
 * Auth posture: the global `JwtAuthGuard` already requires a bearer token on
 * every route here (nothing is `@Public()` — memory contents are sensitive by
 * definition). On top of that, `PermissionsGuard` enforces:
 *   - `core:brain:write` on `POST /remember`
 *   - `core:brain:read`  on `POST /query`, `GET /graph`, `GET /stats`
 * Reads are permissioned rather than merely-authenticated because the graph
 * indexes source code and internal notes.
 *
 * Nothing here throws when the brain is absent: `stats` reports
 * `available: false`, `graph` returns an empty graph with a reason, and
 * `query` answers honestly with `grounded: false`.
 */
@ApiTags("brain")
@ApiBearerAuth()
@Controller("brain")
@UseGuards(PermissionsGuard)
export class BrainController {
  constructor(private readonly brain: BrainService) {}

  @Post("remember")
  @RequirePermissions(CorePermissions.BRAIN_WRITE)
  @ApiOperation({ summary: "Append a memory to the brain/ vault." })
  @ApiOkResponse({ description: "Accepted; the note was appended to the vault." })
  async remember(
    @Body() dto: RememberDto,
    @CurrentUser() user?: AuthPrincipal,
  ): Promise<{ ok: true }> {
    await this.brain.remember({
      title: dto.title,
      body: dto.body,
      tags: dto.tags,
      // Attribute the memory to the caller when we know who they are; the
      // client-supplied `source` is kept but never allowed to impersonate.
      source: user?.email ? `${user.email}${dto.source ? ` (${dto.source})` : ""}` : dto.source,
    });
    return { ok: true };
  }

  @Post("query")
  @RequirePermissions(CorePermissions.BRAIN_READ)
  @ApiOperation({ summary: "Ask the brain; returns a grounded answer + provenance." })
  query(@Body() dto: QueryDto): Promise<MemoryAnswer> {
    return this.brain.query(dto.question);
  }

  @Get("graph")
  @RequirePermissions(CorePermissions.BRAIN_READ)
  @ApiOperation({ summary: "graph.json for the portal visualization (empty when unbuilt)." })
  graph(): Promise<GraphJson> {
    return this.brain.graph();
  }

  @Get("stats")
  @RequirePermissions(CorePermissions.BRAIN_READ)
  @ApiOperation({ summary: "Node/edge counts, vault size, and last build time." })
  stats(): Promise<MemoryStats> {
    return this.brain.stats();
  }
}
