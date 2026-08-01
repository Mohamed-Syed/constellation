import { Injectable, Logger } from "@nestjs/common";
import type { Role } from "@prisma/client";
import { PrismaService } from "../database/prisma.service.js";

export interface RoleDefinition {
  name: string;
  description?: string;
  permissions: string[];
}

/**
 * Role CRUD + lookup, backing `AdminSeedService`'s bootstrap seed today and
 * any future role-management admin UI. Same degrade-not-throw shape as the
 * rest of the core: every method fails soft (empty result / no-op + warn)
 * when there's no database, rather than throwing, so callers that can
 * tolerate "no roles yet" (like boot-time seeding) don't need special-case
 * handling.
 */
@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Role[]> {
    const db = this.prisma.db;
    if (!db) return [];
    return db.role.findMany({ orderBy: { name: "asc" } });
  }

  async findByName(name: string): Promise<Role | null> {
    const db = this.prisma.db;
    if (!db) return null;
    return db.role.findUnique({ where: { name } });
  }

  /** Idempotent create-or-update by role name. No-op-with-warn if no database. */
  async ensure(def: RoleDefinition): Promise<Role | undefined> {
    const db = this.prisma.db;
    if (!db) {
      this.logger.warn(`Cannot ensure role "${def.name}": no database is available.`);
      return undefined;
    }
    return db.role.upsert({
      where: { name: def.name },
      create: { name: def.name, description: def.description, permissions: def.permissions },
      update: { description: def.description, permissions: def.permissions },
    });
  }

  /** The union of every named role's permissions. Unknown role names are ignored. */
  async permissionsForRoleNames(names: readonly string[]): Promise<string[]> {
    const db = this.prisma.db;
    if (!db || names.length === 0) return [];
    const roles = await db.role.findMany({ where: { name: { in: [...names] } } });
    return [...new Set(roles.flatMap((r) => r.permissions))];
  }
}
