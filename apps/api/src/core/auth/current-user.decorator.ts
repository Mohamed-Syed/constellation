import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthPrincipal } from "./token-verifier.js";
import type { AuthenticatedRequest } from "./jwt-auth.guard.js";

/** Injects the `AuthPrincipal` that `JwtAuthGuard` attached to the request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
