import { describe, expect, it, vi } from "vitest";
import { CorePermissions } from "@constellation/plugin-sdk";
import { REQUIRED_PERMISSIONS_KEY } from "../rbac/require-permissions.decorator.js";
import { MeshController } from "./mesh.controller.js";
import type { MeshService } from "./mesh.service.js";

/** Every mesh route must be admin-gated — a missing decorator is a silent authz hole. */
describe("MeshController — RBAC metadata + delegation (4.6)", () => {
  const routes: Array<[string, keyof MeshController]> = [
    ["topology", "topology"],
    ["register", "register"],
    ["probe", "probe"],
    ["remove", "remove"],
  ];

  it.each(routes)("%s is gated by core:mesh:manage", (_route, method) => {
    const required = Reflect.getMetadata(
      REQUIRED_PERMISSIONS_KEY,
      (MeshController.prototype as Record<string, unknown>)[method as string],
    );
    expect(required).toEqual([CorePermissions.MESH_MANAGE]);
  });

  it("register delegates to the service and wraps the peer", async () => {
    const peer = { id: "p1", name: "dev", baseUrl: "http://localhost:4002", apiKeyHash: null, status: "up", lastSeen: null, lastError: null, lastProbedAt: null };
    const service = { register: vi.fn().mockResolvedValue({ ok: true, peer }) } as unknown as MeshService;
    const ctrl = new MeshController(service);
    const dto = { name: "dev", baseUrl: "http://localhost:4002" };

    await expect(ctrl.register(dto)).resolves.toEqual({ peer });
    expect(service.register).toHaveBeenCalledWith(dto);
  });

  it("register maps a duplicate to 409 Conflict so the portal can toast the real reason", async () => {
    const service = { register: vi.fn().mockResolvedValue({ ok: false, error: "duplicate" }) } as unknown as MeshService;
    const ctrl = new MeshController(service);

    await expect(ctrl.register({ name: "dev", baseUrl: "http://localhost:4002" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("register maps no-db to 503 ServiceUnavailable", async () => {
    const service = { register: vi.fn().mockResolvedValue({ ok: false, error: "no-db" }) } as unknown as MeshService;
    const ctrl = new MeshController(service);

    await expect(ctrl.register({ name: "dev", baseUrl: "http://localhost:4002" })).rejects.toMatchObject({
      status: 503,
    });
  });

  it("probe and remove delegate with the peer id", async () => {
    const service = {
      probe: vi.fn().mockResolvedValue(null),
      remove: vi.fn().mockResolvedValue(true),
    } as unknown as MeshService;
    const ctrl = new MeshController(service);

    await expect(ctrl.probe("peer_1")).resolves.toEqual({ peer: null });
    expect(service.probe).toHaveBeenCalledWith("peer_1");
    await expect(ctrl.remove("peer_1")).resolves.toEqual({ ok: true });
    expect(service.remove).toHaveBeenCalledWith("peer_1");
  });
});
