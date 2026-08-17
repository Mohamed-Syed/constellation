import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { LocalJwtVerifier } from "./local-jwt-verifier.service.js";
import { OidcJwtVerifier } from "./oidc-jwt-verifier.service.js";
import type { AuthPrincipal, TokenVerifier } from "./token-verifier.js";

/**
 * The `TOKEN_VERIFIER` actually bound in `AuthModule`. It tries each
 * configured verifier in order and returns the first principal produced.
 *
 * Order is deliberate: **local first**, OIDC second.
 *  - Local verification is a pure in-process HMAC check — microseconds, no
 *    network — so putting it first means the platform's own tokens (the
 *    seeded admin, service logins, every existing test) never pay for, or
 *    depend on, an IdP being reachable.
 *  - OIDC runs only when the local check declines, which is exactly the
 *    "token came from Keycloak/Authentik" case.
 *
 * This is the migration path P3 needs: SSO can be switched on without
 * invalidating local logins, and switched off again without locking anyone
 * out. With `OIDC_ISSUER_URL` unset the OIDC verifier reports itself
 * disabled and is skipped entirely, so behaviour is byte-for-byte what it
 * was before SSO existed.
 *
 * Degrade-never-throw: a verifier that throws is logged and treated as
 * "declined", so one broken provider cannot take authentication down.
 */
@Injectable()
export class CompositeTokenVerifier implements TokenVerifier, OnModuleInit {
  private readonly logger = new Logger(CompositeTokenVerifier.name);

  constructor(
    private readonly local: LocalJwtVerifier,
    private readonly oidc: OidcJwtVerifier,
  ) {}

  onModuleInit(): void {
    if (this.oidc.isEnabled) {
      this.logger.log(`SSO enabled — OIDC verifier active: ${this.oidc.describe()}`);
    } else {
      this.logger.log("SSO not configured — local JWT verification only (set OIDC_ISSUER_URL to enable).");
    }
  }

  async verify(token: string): Promise<AuthPrincipal | null> {
    const local = await this.safe(this.local, token, "local");
    if (local) return local;

    if (!this.oidc.isEnabled) return null;
    return this.safe(this.oidc, token, "oidc");
  }

  private async safe(verifier: TokenVerifier, token: string, label: string): Promise<AuthPrincipal | null> {
    try {
      return await verifier.verify(token);
    } catch (err) {
      this.logger.warn(`Token verifier "${label}" threw — treating as declined: ${asMessage(err)}`);
      return null;
    }
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
