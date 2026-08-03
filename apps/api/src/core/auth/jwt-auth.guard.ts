import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { readAuthCookie } from "./auth-cookie.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { TOKEN_VERIFIER, type AuthPrincipal, type TokenVerifier } from "./token-verifier.js";

export interface AuthenticatedRequest extends Request {
  user?: AuthPrincipal;
}

/**
 * Global `APP_GUARD`: every route requires a valid token by default UNLESS it
 * (or its controller) carries `@Public()`. Public routes today: the health
 * check (`GET /api/health`), the login endpoint, and the plugin read API.
 *
 * Token source (Platform hardening v0.6 — additive, backward compatible):
 * 1. The `Authorization: Bearer <token>` header (the original, unchanged
 *    bearer-token flow — existing clients keep working as-is), or
 * 2. The `constellation_token` httpOnly, SameSite=Lax cookie (set on login),
 *    used when no Authorization header is present. This lets a session whose
 *    token lives only in the httpOnly cookie authenticate its requests; the
 *    `@CurrentUser()` principal is populated exactly the same way for both,
 *    so every downstream guard/controller is unchanged.
 *
 * The Authorization header, when present, always wins (a client that
 * explicitly sends a bearer token has chosen it). No auth is ever weakened:
 * nothing is authenticated without a verifiable token from one of these two
 * sources.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractToken(request);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const principal = await this.verifier.verify(token);
    if (!principal) {
      throw new UnauthorizedException("Invalid or expired token.");
    }

    request.user = principal;
    return true;
  }
}

/**
 * Resolve the access token for this request: the `Authorization: Bearer`
 * header if present, otherwise the httpOnly auth cookie. Returns `undefined`
 * when neither carries a token.
 */
function extractToken(request: Request): string | undefined {
  const fromHeader = extractBearerToken(request);
  if (fromHeader) return fromHeader;
  return readAuthCookie(request.headers.cookie);
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}
