import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AuthenticatedRequest, JwtAuthGuard } from "./jwt-auth.guard.js";
import type { AuthPrincipal, TokenVerifier } from "./token-verifier.js";

const principal: AuthPrincipal = { id: "u1", email: "u1@x.com", roles: ["admin"], permissions: ["platform:admin"] };

function fakeContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;
}

function fakeReflector(isPublic: boolean | undefined): Reflector {
  return { getAllAndOverride: () => isPublic } as unknown as Reflector;
}

function fakeVerifier(result: AuthPrincipal | null): TokenVerifier {
  return { verify: vi.fn().mockResolvedValue(result) };
}

const originalPrefix = process.env.API_GLOBAL_PREFIX;

describe("JwtAuthGuard", () => {
  beforeEach(() => {
    delete process.env.API_GLOBAL_PREFIX; // default "api" prefix
  });
  afterEach(() => {
    if (originalPrefix === undefined) delete process.env.API_GLOBAL_PREFIX;
    else process.env.API_GLOBAL_PREFIX = originalPrefix;
  });

  it("lets @Public() routes through with no token at all", async () => {
    const guard = new JwtAuthGuard(fakeReflector(true), fakeVerifier(null));
    const request = { method: "POST", path: "/api/auth/login", headers: {} };
    await expect(guard.canActivate(fakeContext(request))).resolves.toBe(true);
  });

  it("no longer special-cases the health path — public-ness comes from @Public() on the controller", async () => {
    // The guard has no hardcoded path bypass anymore (removed at P2 integration):
    // a route is public iff the reflector reports @Public. In production
    // health.controller.ts carries @Public(); simulated here as reflector=false
    // (no @Public) → the guard correctly demands a token.
    const guard = new JwtAuthGuard(fakeReflector(false), fakeVerifier(null));
    const request = { method: "GET", path: "/api/health", headers: {} };
    await expect(guard.canActivate(fakeContext(request))).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a protected route with no bearer token", async () => {
    const guard = new JwtAuthGuard(fakeReflector(false), fakeVerifier(null));
    const request = { method: "GET", path: "/api/audit", headers: {} };
    await expect(guard.canActivate(fakeContext(request))).rejects.toThrow(UnauthorizedException);
  });

  it("rejects an invalid/expired token", async () => {
    const guard = new JwtAuthGuard(fakeReflector(false), fakeVerifier(null));
    const request = { method: "GET", path: "/api/audit", headers: { authorization: "Bearer bad.token" } };
    await expect(guard.canActivate(fakeContext(request))).rejects.toThrow(UnauthorizedException);
  });

  it("attaches the principal and allows through on a valid token", async () => {
    const guard = new JwtAuthGuard(fakeReflector(false), fakeVerifier(principal));
    const request: Partial<AuthenticatedRequest> = {
      method: "GET",
      path: "/api/audit",
      headers: { authorization: "Bearer good.token" },
    };
    await expect(guard.canActivate(fakeContext(request))).resolves.toBe(true);
    expect(request.user).toEqual(principal);
  });
});
