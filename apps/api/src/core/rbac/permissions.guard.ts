import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasAllPermissions } from "@constellation/plugin-sdk";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard.js";
import { REQUIRED_PERMISSIONS_KEY } from "./require-permissions.decorator.js";

/**
 * Route-scoped guard (NOT global — bind it explicitly with
 * `@UseGuards(PermissionsGuard)` next to `@RequirePermissions(...)`) that
 * checks the authenticated user's flattened permission set against what the
 * route declares. Relies on `JwtAuthGuard` (the global `APP_GUARD`) having
 * already populated `request.user` — if it hasn't (e.g. this guard is bound
 * without the auth guard ever running), that's an auth failure, not a
 * permissions one.
 *
 * Delegates the actual matching to the SDK's `hasAllPermissions`
 * (colon-scoped strings, trailing-`*` wildcards, `platform:admin` implies
 * all) so RBAC semantics are defined in exactly one place for both core and
 * plugin permissions.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException("Authentication is required before permissions can be checked.");
    }

    if (!hasAllPermissions(request.user.permissions, required)) {
      throw new ForbiddenException(
        `Missing required permission(s): ${required.join(", ")}`,
      );
    }
    return true;
  }
}
