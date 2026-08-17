import { Injectable, Logger, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { MetricsService } from "../observability/metrics/metrics.service.js";
import type { JwtPayload } from "./jwt-payload.js";
import type { AuthPrincipal } from "./token-verifier.js";

export interface LoginResult {
  accessToken: string;
  user: { id: string; email: string; roles: string[] };
}

/**
 * Local email/password auth. Every DB-touching method fails with a clean,
 * expected error when there's no database — never a 500, matching the
 * platform-wide "boot with no DB" invariant (see `PrismaService`).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    // Phase 2.0 2.3 — auth metrics feed (trailing @Optional(), offline tests
    // construct positionally and stay green).
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const db = this.prisma.db;
    if (!db) {
      throw new ServiceUnavailableException(
        "Auth is unavailable: no database is configured. Set DATABASE_URL and try again.",
      );
    }

    const user = await db.user.findUnique({
      where: { email },
      include: { roles: { include: { role: true } } },
    });

    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      // Same message whether the email doesn't exist or the password is
      // wrong — don't leak which one it was.
      this.metrics?.recordAuthLogin("password", "failure");
      throw new UnauthorizedException("Invalid email or password.");
    }

    const roles = user.roles.map((ur) => ur.role.name);
    const permissions = uniq(user.roles.flatMap((ur) => ur.role.permissions));

    const payload: JwtPayload = { sub: user.id, email: user.email, roles, permissions };
    const accessToken = await this.jwt.signAsync(payload);

    await this.audit.record(user.id, "auth.login", user.email);
    this.metrics?.recordAuthLogin("password", "success");

    return { accessToken, user: { id: user.id, email: user.email, roles } };
  }

  /** Backs `GET /api/auth/me` — the request's `AuthPrincipal` IS this response shape. */
  me(principal: AuthPrincipal): AuthPrincipal {
    return principal;
  }
}

function uniq(values: readonly string[]): string[] {
  return [...new Set(values)];
}
