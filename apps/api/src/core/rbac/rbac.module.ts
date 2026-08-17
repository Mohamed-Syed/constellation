import { Global, Module } from "@nestjs/common";
import { PermissionsGuard } from "./permissions.guard.js";
import { RolesService } from "./roles.service.js";

/**
 * RBAC building blocks: `RolesService` (role CRUD/lookup) and
 * `PermissionsGuard` (route-scoped, bind with `@UseGuards(PermissionsGuard)`
 * + `@RequirePermissions(...)` — NOT global, unlike `JwtAuthGuard`). Global
 * so any module can `@UseGuards(PermissionsGuard)` / inject `RolesService`
 * without re-importing this module.
 */
@Global()
@Module({
  providers: [RolesService, PermissionsGuard],
  exports: [RolesService, PermissionsGuard],
})
export class RbacModule {}
