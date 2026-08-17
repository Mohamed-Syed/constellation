import { describe, expect, it, vi } from "vitest";
import { CorePermissions } from "@constellation/plugin-sdk";
import type { GraphJson, MemoryAnswer, MemoryStats } from "@constellation/plugin-sdk";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { BrainController } from "./brain.controller.js";
import type { BrainService } from "./brain.service.js";
import { REQUIRED_PERMISSIONS_KEY } from "../rbac/require-permissions.decorator.js";

/**
 * Controller-level tests: the RBAC metadata each route declares (this is the
 * security contract — a missing decorator is a silent authz hole that a
 * behavioural test would never catch) plus the caller-attribution rule on
 * `remember`.
 */

const emptyStats: MemoryStats = {
  nodes: 0,
  edges: 0,
  lastBuiltAt: null,
  available: false,
  vaultNotes: 0,
};

function fakeBrain(overrides: Partial<BrainService> = {}): BrainService {
  return {
    remember: vi.fn(async () => undefined),
    query: vi.fn(async (): Promise<MemoryAnswer> => ({ answer: "a", provenance: [], grounded: false })),
    stats: vi.fn(async () => emptyStats),
    graph: vi.fn(async (): Promise<GraphJson> => ({ nodes: [], edges: [] })),
    explain: vi.fn(async () => null),
    path: vi.fn(async () => []),
    ...overrides,
  } as unknown as BrainService;
}

/** Read the permissions `@RequirePermissions` stamped onto a route handler. */
function requiredPermissions(method: keyof BrainController): string[] | undefined {
  return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BrainController.prototype[method] as object);
}

describe("BrainController — RBAC contract", () => {
  it("POST /remember requires core:brain:write", () => {
    expect(requiredPermissions("remember")).toEqual([CorePermissions.BRAIN_WRITE]);
  });

  it("POST /query requires core:brain:read", () => {
    expect(requiredPermissions("query")).toEqual([CorePermissions.BRAIN_READ]);
  });

  it("GET /graph requires core:brain:read", () => {
    expect(requiredPermissions("graph")).toEqual([CorePermissions.BRAIN_READ]);
  });

  it("GET /stats requires core:brain:read", () => {
    expect(requiredPermissions("stats")).toEqual([CorePermissions.BRAIN_READ]);
  });

  it("declares the new permissions with the expected string values", () => {
    expect(CorePermissions.BRAIN_READ).toBe("core:brain:read");
    expect(CorePermissions.BRAIN_WRITE).toBe("core:brain:write");
  });
});

describe("BrainController — behaviour", () => {
  it("attributes a remembered note to the authenticated caller", async () => {
    const brain = fakeBrain();
    const controller = new BrainController(brain);
    const user = { id: "u1", email: "agent@example.com", roles: ["admin"], permissions: [] } as AuthPrincipal;
    await controller.remember({ title: "T", body: "B", source: "cli" }, user);
    expect(brain.remember).toHaveBeenCalledWith(
      expect.objectContaining({ source: "agent@example.com (cli)" }),
    );
  });

  it("falls back to the client-supplied source when there is no principal", async () => {
    const brain = fakeBrain();
    await new BrainController(brain).remember({ title: "T", body: "B", source: "job" }, undefined);
    expect(brain.remember).toHaveBeenCalledWith(expect.objectContaining({ source: "job" }));
  });

  it("passes stats/graph/query straight through", async () => {
    const brain = fakeBrain();
    const c = new BrainController(brain);
    expect(await c.stats()).toEqual(emptyStats);
    expect(await c.graph()).toEqual({ nodes: [], edges: [] });
    expect((await c.query({ question: "q" })).grounded).toBe(false);
    expect(brain.query).toHaveBeenCalledWith("q");
  });
});
