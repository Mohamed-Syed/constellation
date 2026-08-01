import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { TOKEN_VERIFIER, type AuthPrincipal, type TokenVerifier } from "./token-verifier.js";

export interface AuthenticatedRequest extends Request {
  user?: AuthPrincipal;
}

/**
 * Global `APP_GUARD`: every route requires a valid bearer token UNLESS it
 * (or its controller) carries `@Public()`. Public routes today: the health
 * check (`GET /api/health`), the login endpoint, and the plugin read API.
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
    const token = extractBearerToken(request);
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

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}
