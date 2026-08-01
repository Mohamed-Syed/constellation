import { Body, Controller, HttpCode, Post, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service.js";
import { CurrentUser } from "./current-user.decorator.js";
import { LoginDto } from "./dto/login.dto.js";
import { Public } from "./public.decorator.js";
import type { AuthPrincipal } from "./token-verifier.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  @ApiOkResponse({ description: "Bearer token + basic user identity." })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get("me")
  @ApiBearerAuth()
  @ApiOkResponse({ description: "The authenticated user's identity, roles, and effective permissions." })
  me(@CurrentUser() user: AuthPrincipal) {
    return this.auth.me(user);
  }

  @Post("logout")
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOkResponse({ description: "Stateless logout acknowledgement — the client discards its token." })
  logout() {
    return { ok: true };
  }
}
