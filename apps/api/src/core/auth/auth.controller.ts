import { Body, Controller, HttpCode, Post, Req, Res, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { clearAuthCookie, readAuthCookie, setAuthCookie } from "./auth-cookie.js";
import { CurrentUser } from "./current-user.decorator.js";
import { LoginDto } from "./dto/login.dto.js";
import { Public } from "./public.decorator.js";
import type { AuthPrincipal } from "./token-verifier.js";
import { TeamService } from "../teams/team.service.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly teams: TeamService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  @ApiOkResponse({ description: "Bearer token + basic user identity." })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password);
    // httpOnly cookie hardening (Platform hardening v0.6): ALSO set the access
    // token as an httpOnly, SameSite=Lax cookie (`Secure` only in production)
    // so the portal's session survives reloads without JS ever touching the
    // token (closes the localStorage XSS caveat in the portal). Additive — the
    // token is still returned in the body so existing bearer-token clients
    // keep working unchanged.
    setAuthCookie(res, result.accessToken);
    return result;
  }

  @Get("me")
  @ApiBearerAuth()
  @ApiOkResponse({ description: "The authenticated user's identity, roles, and effective permissions." })
  async me(@CurrentUser() user: AuthPrincipal) {
    // Team spaces round: augment the principal with the caller's teams.
    const teams = await this.teams.listForUser(user.id);
    return { ...this.auth.me(user), teams };
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  @ApiOkResponse({ description: "Stateless logout acknowledgement — clears the httpOnly auth cookie." })
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // @Public() on purpose: logout must succeed even when the session token
    // has expired or is missing (a cookie a client can't clear itself would
    // be a footgun). It is a no-op that only clears the httpOnly cookie and
    // acknowledges — nothing destructive, nothing an unauthenticated caller
    // could abuse. The client should also discard any bearer token it holds.
    // Stateless server-side: there is nothing to revoke.
    if (readAuthCookie(req.headers.cookie) !== undefined) {
      clearAuthCookie(res);
    }
    return { ok: true };
  }
}
