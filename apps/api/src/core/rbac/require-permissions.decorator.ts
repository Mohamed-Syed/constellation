import { SetMetadata } from "@nestjs/common";

export const REQUIRED_PERMISSIONS_KEY = "constellation:requiredPermissions";

/**
 * Declares the permission(s) a route needs. Enforced by `PermissionsGuard`
 * against `request.user.permissions` (populated by `JwtAuthGuard`, which
 * must run first — apply this alongside `@UseGuards(PermissionsGuard)` on
 * routes that need it; it does NOT run globally). Uses the SDK's colon-scoped
 * permission strings and wildcard/`platform:admin` matching via
 * `hasAllPermissions` — see `@constellation/plugin-sdk`'s `permissions.ts`.
 */
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
