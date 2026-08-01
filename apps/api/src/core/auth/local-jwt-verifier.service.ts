import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { JwtPayload } from "./jwt-payload.js";
import type { AuthPrincipal, TokenVerifier } from "./token-verifier.js";

/**
 * The default (and today, only) `TOKEN_VERIFIER` implementation: verifies
 * the platform's own HS256 JWT via `@nestjs/jwt`. See `token-verifier.ts`
 * for why this is behind an interface — an OIDC/JWKS verifier can be added
 * as a sibling implementation later without touching `JwtAuthGuard` or any
 * controller.
 */
@Injectable()
export class LocalJwtVerifier implements TokenVerifier {
  private readonly logger = new Logger(LocalJwtVerifier.name);

  constructor(private readonly jwt: JwtService) {}

  async verify(token: string): Promise<AuthPrincipal | null> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      return {
        id: payload.sub,
        email: payload.email,
        roles: payload.roles ?? [],
        permissions: payload.permissions ?? [],
      };
    } catch (err) {
      this.logger.debug(`Token verification failed: ${asMessage(err)}`);
      return null;
    }
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
