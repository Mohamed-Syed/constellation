import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { CorePermissions } from "@constellation/plugin-sdk";
import { PrismaService } from "../database/prisma.service.js";
import { RolesService } from "../rbac/roles.service.js";

const DEFAULT_ADMIN_EMAIL = "admin@constellation.local";
const DEFAULT_ADMIN_PASSWORD = "changeme";
const DEFAULT_VIEWER_EMAIL = "viewer@constellation.local";
const DEFAULT_VIEWER_PASSWORD = "changeme";

/**
 * Seeds the `admin` + `viewer` roles, a default admin user, and a default
 * `viewer` (non-admin) user on boot.
 *
 * Runs on `onApplicationBootstrap` (not `onModuleInit`) so it's guaranteed
 * to fire after `PrismaService.onModuleInit` has finished attempting its
 * connection — seeding needs to know definitively whether a database is
 * available. Follows the platform-wide "degrade, never throw" pattern: no
 * database (or any seed failure) logs a warning and the app keeps booting,
 * it just starts with zero users (so `/api/auth/login` will 503 until a DB
 * shows up).
 *
 * Platform hardening (v0.6): a `viewer` USER is now seeded too (previously
 * only the `viewer` ROLE existed). This makes the RBAC 403 path live-testable
 * — the portal's non-admin view had no real non-admin account to exercise it.
 * A `viewer@constellation.local` login yields a JWT whose permission set is
 * ONLY `core:authenticated`, so an admin-only route (`@RequirePermissions`
 * + `PermissionsGuard`) correctly drops it with a 403 rather than a 401.
 */
@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: RolesService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const db = this.prisma.db;
    if (!db) {
      this.logger.warn(
        "No database available — skipping admin/viewer role + admin/viewer user seed.",
      );
      return;
    }

    try {
      const adminRole = await this.roles.ensure({
        name: "admin",
        description: "Full platform administrator.",
        permissions: [CorePermissions.PLATFORM_ADMIN],
      });
      const viewerRole = await this.roles.ensure({
        name: "viewer",
        description: "Authenticated read-only user.",
        permissions: [CorePermissions.AUTHENTICATED],
      });
      // RolesService already warned if the db vanished mid-seed; degrade
      // quietly rather than tripping over a missing role.
      if (!adminRole || !viewerRole) return;

      // Idempotent user+role seeding shared by the admin and viewer accounts.
      // Never overwrites a password an operator may have since changed.
      await this.seedRoleUser(adminRole.id, {
        emailEnv: "ADMIN_EMAIL",
        passwordEnv: "ADMIN_PASSWORD",
        defaultEmail: DEFAULT_ADMIN_EMAIL,
        defaultPassword: DEFAULT_ADMIN_PASSWORD,
        label: "admin",
      });
      await this.seedRoleUser(viewerRole.id, {
        emailEnv: "VIEWER_EMAIL",
        passwordEnv: "VIEWER_PASSWORD",
        defaultEmail: DEFAULT_VIEWER_EMAIL,
        defaultPassword: DEFAULT_VIEWER_PASSWORD,
        label: "viewer",
      });
    } catch (err) {
      this.logger.warn(
        `Admin/viewer role + user seed failed — continuing without it: ${asMessage(err)}`,
      );
    }
  }

  private async seedRoleUser(
    roleId: string,
    opts: {
      emailEnv: string;
      passwordEnv: string;
      defaultEmail: string;
      defaultPassword: string;
      label: string;
    },
  ): Promise<void> {
    const db = this.prisma.db;
    if (!db) return;

    const email = process.env[opts.emailEnv]?.trim() || opts.defaultEmail;
    const password = process.env[opts.passwordEnv]?.trim() || opts.defaultPassword;

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      // Idempotent: make sure the seeded user still holds the role, but
      // never overwrite a password an operator may have since changed.
      await db.userRole.upsert({
        where: { userId_roleId: { userId: existing.id, roleId } },
        create: { userId: existing.id, roleId },
        update: {},
      });
      this.logger.log(
        `Roles ensured; ${opts.label} user "${email}" already exists.`,
      );
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.user.create({ data: { email, passwordHash } });
    await db.userRole.create({ data: { userId: user.id, roleId } });

    if (!process.env[opts.emailEnv] || !process.env[opts.passwordEnv]) {
      this.logger.warn(
        `Seeded ${opts.label} user "${email}" with the DEV DEFAULT password. Set ` +
          `${opts.emailEnv} / ${opts.passwordEnv} before running anywhere real.`,
      );
    } else {
      this.logger.log(`Seeded ${opts.label} user "${email}".`);
    }
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
