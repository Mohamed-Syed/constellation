import { Logger, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule, type JwtModuleOptions } from "@nestjs/jwt";
import { AdminSeedService } from "./admin-seed.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { CompositeTokenVerifier } from "./composite-token-verifier.service.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
import { LocalJwtVerifier } from "./local-jwt-verifier.service.js";
import { OidcJwtVerifier } from "./oidc-jwt-verifier.service.js";
import { TOKEN_VERIFIER } from "./token-verifier.js";

const DEV_JWT_SECRET_FALLBACK = "constellation-dev-secret-change-me";
if (!process.env.JWT_SECRET) {
  Logger.warn(
    "JWT_SECRET is not set — using a fixed dev-only fallback secret. Tokens issued now will " +
      "NOT verify against a differently-configured instance, and this is unsafe for anything " +
      "beyond local development.",
    "AuthModule",
  );
}

/**
 * Auth: local JWT login today, OIDC-ready by construction (see
 * `token-verifier.ts`). Registers `JwtAuthGuard` as the global `APP_GUARD` —
 * every route requires a valid bearer token by default; opt out per-route
 * with `@Public()`. Global because this module is imported exactly once
 * from `AppModule` (Nest's requirement for `APP_GUARD` providers).
 */
@Module({
  imports: [
    JwtModule.register({
      global: false,
      secret: process.env.JWT_SECRET ?? DEV_JWT_SECRET_FALLBACK,
      signOptions: {
        // `expiresIn` is typed by `jsonwebtoken` as `number | StringValue` (a
        // template-literal type like "1h"/"30m"), which a plain `string` env
        // var can't satisfy structurally — the env value's *shape* is
        // validated by `jsonwebtoken` itself at sign time, so this cast is
        // safe (a malformed value throws there, not silently mis-signs).
        expiresIn: (process.env.JWT_EXPIRES_IN ?? "1h") as NonNullable<JwtModuleOptions["signOptions"]>["expiresIn"],
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AdminSeedService,
    LocalJwtVerifier,
    OidcJwtVerifier,
    // The bound verifier is the composite: local JWT first (fast, offline),
    // then OIDC when `OIDC_ISSUER_URL` is configured. Guards and controllers
    // are unchanged — they still only know the `TOKEN_VERIFIER` interface.
    { provide: TOKEN_VERIFIER, useClass: CompositeTokenVerifier },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [TOKEN_VERIFIER, JwtModule],
})
export class AuthModule {}
