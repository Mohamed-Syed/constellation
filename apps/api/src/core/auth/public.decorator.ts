import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "constellation:isPublic";

/**
 * Marks a route (or an entire controller) as reachable without a bearer
 * token. `JwtAuthGuard` — registered globally via `APP_GUARD` — checks this
 * first and skips authentication entirely when set. Used today on
 * `POST /api/auth/login`; everything else requires auth by default.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
