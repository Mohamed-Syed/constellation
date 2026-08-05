import { describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { TeamService } from "./team.service.js";
import type { PrismaService } from "../database/prisma.service.js";

function makeDb(overrides: Record<string, unknown> = {}) {
  const delegates = {
    organization: { create: vi.fn(async (args: unknown) => ({ id: "org-1", ...(args as { data: object }).data })) },
    team: { create: vi.fn(async (args: unknown) => ({ id: "team-1", ...(args as { data: object }).data })) },
    teamMember: {
      create: vi.fn(async () => ({ id: "m1" })),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: "m1" })),
      delete: vi.fn(async () => ({ id: "m1" })),
    },
    user: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(delegates)),
    ...overrides,
  };
  return delegates;
}

function svcWith(db: Record<string, unknown>): TeamService {
  return new TeamService({ db } as unknown as PrismaService);
}

describe("TeamService — create / list / detail", () => {
  it("creates org + team + OWNER membership in one transaction", async () => {
    const db = makeDb();
    const svc = svcWith(db);
    const team = await svc.create("user-1", " core-team ");
    expect(team).toEqual({ id: "team-1", name: "core-team", orgId: "org-1", role: "owner" });
    expect(db.$transaction).toHaveBeenCalled();
    expect(db.teamMember.create).toHaveBeenCalledWith({ data: { teamId: "team-1", userId: "user-1", role: "owner" } });
  });

  it("create refuses empty names / missing actors", async () => {
    const svc = svcWith(makeDb());
    await expect(svc.create("user-1", "  ")).resolves.toBeNull();
    await expect(svc.create(null, "core-team")).resolves.toBeNull();
  });

  it("listForUser maps memberships to team views with roles", async () => {
    const db = makeDb({
      teamMember: {
        findMany: vi.fn(async () => [
          { teamId: "team-1", role: "owner", team: { id: "team-1", name: "Core", orgId: "org-1", org: { id: "org-1" } } },
          { teamId: "team-2", role: "member", team: { id: "team-2", name: "Data", orgId: "org-1", org: { id: "org-1" } } },
        ]),
      },
    });
    const svc = svcWith(db);
    const teams = await svc.listForUser("user-1");
    expect(teams).toEqual([
      { id: "team-1", name: "Core", orgId: "org-1", role: "owner" },
      { id: "team-2", name: "Data", orgId: "org-1", role: "member" },
    ]);
  });

  it("detail returns the team with member emails", async () => {
    const db = makeDb({
      team: {
        findUnique: vi.fn(async () => ({
          id: "team-1",
          name: "Core",
          orgId: "org-1",
          members: [
            { userId: "u1", role: "owner", user: { email: "a@b.c" } },
            { userId: "u2", role: "member", user: { email: "v@b.c" } },
          ],
        })),
      },
    });
    const svc = svcWith(db);
    const detail = await svc.detail("team-1");
    expect(detail?.members).toEqual([
      { userId: "u1", email: "a@b.c", role: "owner" },
      { userId: "u2", email: "v@b.c", role: "member" },
    ]);
  });
});

describe("TeamService — members + RBAC", () => {
  it("addMember upserts the role for an EXISTING user; null for unknown", async () => {
    const db = makeDb({ user: { findUnique: vi.fn(async () => ({ id: "u9", email: "v@b.c" })) } });
    const svc = svcWith(db);
    const member = await svc.addMember("team-1", "V@b.c", "admin");
    expect(member).toEqual({ userId: "u9", email: "v@b.c", role: "admin" });
    expect(db.teamMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teamId_userId: { teamId: "team-1", userId: "u9" } } }),
    );

    const db2 = makeDb();
    const svc2 = svcWith(db2);
    await expect(svc2.addMember("team-1", "ghost@b.c")).resolves.toBeNull();
  });

  it("removeMember deletes non-owner memberships; protects the owner; false when missing", async () => {
    const db = makeDb({
      teamMember: {
        findUnique: vi.fn(async () => ({ id: "m1", role: "member" })),
        delete: vi.fn(async () => ({ id: "m1" })),
      },
    });
    const svc = svcWith(db);
    await expect(svc.removeMember("team-1", "u2")).resolves.toBe(true);

    const db2 = makeDb({ teamMember: { findUnique: vi.fn(async () => ({ id: "m1", role: "owner" })) } });
    const svc2 = svcWith(db2);
    await expect(svc2.removeMember("team-1", "u1")).resolves.toBe(false);

    const db3 = makeDb();
    const svc3 = svcWith(db3);
    await expect(svc3.removeMember("team-1", "u9")).resolves.toBe(false);
  });

  it("canManage only for owner/admin; isMember for any membership", async () => {
    const withRole = (role: string | null) =>
      makeDb({ teamMember: { findUnique: vi.fn(async () => (role ? { role } : null)) } });
    await expect(svcWith(withRole("owner")).canManage("u1", "t1")).resolves.toBe(true);
    await expect(svcWith(withRole("admin")).canManage("u1", "t1")).resolves.toBe(true);
    await expect(svcWith(withRole("member")).canManage("u1", "t1")).resolves.toBe(false);
    await expect(svcWith(withRole(null)).canManage("u1", "t1")).resolves.toBe(false);
    await expect(svcWith(withRole("member")).isMember("u1", "t1")).resolves.toBe(true);
  });
});

describe("TeamService — no-DB degrade", () => {
  it("returns empty/null/false and warns once", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const svc = new TeamService({ db: undefined } as unknown as PrismaService);
    await expect(svc.create("u1", "t")).resolves.toBeNull();
    await expect(svc.listForUser("u1")).resolves.toEqual([]);
    await expect(svc.detail("t1")).resolves.toBeNull();
    await expect(svc.isMember("u1", "t1")).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
