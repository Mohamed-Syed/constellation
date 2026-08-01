import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard.js";
import { PermissionsGuard } from "./permissions.guard.js";

function fakeContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;
}

function fakeReflector(required: string[] | undefined): Reflector {
  return { getAllAndOverride: () => required } as unknown as Reflector;
}

describe("PermissionsGuard", () => {
  it("allows through when the route declares no required permissions", () => {
    const guard = new PermissionsGuard(fakeReflector(undefined));
    expect(guard.canActivate(fakeContext({}))).toBe(true);
  });

  it("allows through when the route declares an empty permission list", () => {
    const guard = new PermissionsGuard(fakeReflector([]));
    expect(guard.canActivate(fakeContext({}))).toBe(true);
  });

  it("throws Unauthorized when a permission is required but no user is attached", () => {
    const guard = new PermissionsGuard(fakeReflector(["core:audit:read"]));
    expect(() => guard.canActivate(fakeContext({}))).toThrow(UnauthorizedException);
  });

  it("throws Forbidden when the user lacks the required permission", () => {
    const guard = new PermissionsGuard(fakeReflector(["core:audit:read"]));
    const request = { user: { id: "u1", email: "u1@x.com", roles: ["viewer"], permissions: ["core:authenticated"] } };
    expect(() => guard.canActivate(fakeContext(request))).toThrow(ForbiddenException);
  });

  it("allows through on an exact permission match", () => {
    const guard = new PermissionsGuard(fakeReflector(["core:audit:read"]));
    const request = { user: { id: "u1", email: "u1@x.com", roles: ["admin"], permissions: ["core:audit:read"] } };
    expect(guard.canActivate(fakeContext(request))).toBe(true);
  });

  it("allows through when the user holds platform:admin (implies all permissions)", () => {
    const guard = new PermissionsGuard(fakeReflector(["core:audit:read", "core:plugin:manage"]));
    const request = { user: { id: "u1", email: "u1@x.com", roles: ["admin"], permissions: ["platform:admin"] } };
    expect(guard.canActivate(fakeContext(request))).toBe(true);
  });

  it("allows through on a wildcard match", () => {
    const guard = new PermissionsGuard(fakeReflector(["core:plugin:manage"]));
    const request = { user: { id: "u1", email: "u1@x.com", roles: ["ops"], permissions: ["core:*"] } };
    expect(guard.canActivate(fakeContext(request))).toBe(true);
  });
});
