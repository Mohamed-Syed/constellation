import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { CorePermissions } from "@constellation/plugin-sdk";
import { PrismaService } from "../database/prisma.service.js";
import { RolesService } from "../rbac/roles.service.js";

const DEFAULT_ADMIN_EMAIL = "admin@constellation.local";
const DEFAULT_ADMIN_PASSWORD = "changeme";

/**
 * Seeds the `admin` + `viewer` roles and a default admin user on boot.
 *
 * Runs on `onApplicationBootstrap` (not `onModuleInit`) so it's guaranteed
 * to fire after `PrismaService.onModuleInit` has finished attempting its
 * connection — seeding needs to know definitively whether a database is
 * available. Follows the platform-wide "degrade, never throw" pattern: no
 * database (or any seed failure) logs a warning and the app keeps booting,
 * it just starts with zero users (so `/api/auth/login` will 503 until a DB
 * shows up).
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
      this.logger.warn("No database available — skipping admin/viewer role + admin user seed.");
      return;
    }

    try {
      const adminRole = await this.roles.ensure({
        name: "admin",
        description: "Full platform administrator.",
        permissions: [CorePermissions.PLATFORM_ADMIN],
      });
      await this.roles.ensure({
        name: "viewer",
        description: "Authenticated read-only user.",
        permissions: [CorePermissions.AUTHENTICATED],
      });
      if (!adminRole) return; // RolesService already warned; db was available a moment ago but degrade anyway.

      const email = process.env.ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL;
      const password = process.env.ADMIN_PASSWORD?.trim() || DEFAULT_ADMIN_PASSWORD;

      const existing = await db.user.findUnique({ where: { email } });
      if (existing) {
        // Idempotent: make sure the seeded admin still holds the admin role,
        // but never overwrite a password an operator may have since changed.
        await db.userRole.upsert({
          where: { userId_roleId: { userId: existing.id, roleId: adminRole.id } },
          create: { userId: existing.id, roleId: adminRole.id },
          update: {},
        });
        this.logger.log(`Admin/viewer roles ensured; admin user "${email}" already exists.`);
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await db.user.create({ data: { email, passwordHash } });
      await db.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });

      if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
        this.logger.warn(
          `Seeded admin user "${email}" with the DEV DEFAULT password. Set ADMIN_EMAIL / ` +
            "ADMIN_PASSWORD before running anywhere real.",
        );
      } else {
        this.logger.log(`Seeded admin user "${email}".`);
      }
    } catch (err) {
      this.logger.warn(`Admin/viewer seed failed — continuing without it: ${asMessage(err)}`);
    }
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
