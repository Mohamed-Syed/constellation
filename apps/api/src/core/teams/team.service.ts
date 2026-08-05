import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";

/** One team as the API returns it. */
export interface TeamView {
  id: string;
  name: string;
  orgId: string;
  role: string;
}

/** Team + its members (emails + roles). */
export interface TeamDetailView {
  id: string;
  name: string;
  orgId: string;
  members: Array<{ userId: string; email: string; role: string }>;
}

const MANAGER_ROLES = new Set(["owner", "admin"]);
const ALL_ROLES = new Set(["owner", "admin", "member"]);

/**
 * Phase 3.0 — team spaces (multi-tenancy foundation).
 *
 * Organization → Team → TeamMember (role owner|admin|member). The creator of
 * a team becomes its owner. Member management is owner/admin-only; team
 * resources (e.g. AgentTask.teamId) are visible to members + platform admins.
 * No-DB degrade: empty lists, null details, false checks — never throws.
 */
@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);
  private warnedNoDb = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Create an organization + team + the creator's owner membership. */
  async create(actorId: string | null, name: string): Promise<TeamView | null> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return null;
    }
    const clean = name.trim();
    if (!clean || !actorId) return null;
    try {
      const team = await db.$transaction(async (tx) => {
        const org = await tx.organization.create({ data: { name: clean } });
        const t = await tx.team.create({ data: { orgId: org.id, name: clean } });
        await tx.teamMember.create({ data: { teamId: t.id, userId: actorId, role: "owner" } });
        return t;
      });
      return { id: team.id, name: team.name, orgId: team.orgId, role: "owner" };
    } catch (err) {
      this.logger.warn(`Team create failed: ${asMessage(err)}`);
      return null;
    }
  }

  /** Every team the user belongs to, with their role. */
  async listForUser(userId: string | null): Promise<TeamView[]> {
    const db = this.prisma.db;
    if (!db || !userId) {
      this.warnNoDbOnce();
      return [];
    }
    try {
      const rows = await db.teamMember.findMany({
        where: { userId },
        include: { team: { include: { org: true } } },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((m) => ({
        id: m.team.id,
        name: m.team.name,
        orgId: m.team.orgId,
        role: m.role,
      }));
    } catch (err) {
      this.logger.warn(`Team list failed: ${asMessage(err)}`);
      return [];
    }
  }

  /** Team + members. Null when the team doesn't exist. */
  async detail(teamId: string): Promise<TeamDetailView | null> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return null;
    }
    try {
      const team = await db.team.findUnique({
        where: { id: teamId },
        include: { members: { include: { user: true } } },
      });
      if (!team) return null;
      return {
        id: team.id,
        name: team.name,
        orgId: team.orgId,
        members: team.members.map((m) => ({ userId: m.userId, email: m.user.email, role: m.role })),
      };
    } catch (err) {
      this.logger.warn(`Team detail failed: ${asMessage(err)}`);
      return null;
    }
  }

  /** Add a member by email. Resolves null when the user isn't found. */
  async addMember(teamId: string, email: string, role = "member"): Promise<{ userId: string; email: string; role: string } | null> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return null;
    }
    const cleanRole = ALL_ROLES.has(role) ? role : "member";
    try {
      const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (!user) return null;
      await db.teamMember.upsert({
        where: { teamId_userId: { teamId, userId: user.id } },
        create: { teamId, userId: user.id, role: cleanRole },
        update: { role: cleanRole },
      });
      return { userId: user.id, email: user.email, role: cleanRole };
    } catch (err) {
      this.logger.warn(`Team addMember failed: ${asMessage(err)}`);
      return null;
    }
  }

  /** Remove a member. Resolves false when the membership doesn't exist or the member is the owner. */
  async removeMember(teamId: string, userId: string): Promise<boolean> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return false;
    }
    try {
      const existing = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
      if (!existing) return false;
      if (existing.role === "owner") return false;
      await db.teamMember.delete({ where: { id: existing.id } });
      return true;
    } catch (err) {
      this.logger.warn(`Team removeMember failed: ${asMessage(err)}`);
      return false;
    }
  }

  /** owner/admin members manage the team. */
  async canManage(userId: string | null, teamId: string): Promise<boolean> {
    return this.memberRole(userId, teamId).then((role) => role !== null && MANAGER_ROLES.has(role));
  }

  /** Any membership. */
  async isMember(userId: string | null, teamId: string): Promise<boolean> {
    return this.memberRole(userId, teamId).then((role) => role !== null);
  }

  /** The user's role in the team, or null. */
  async memberRole(userId: string | null, teamId: string): Promise<string | null> {
    const db = this.prisma.db;
    if (!db || !userId) return null;
    try {
      const row = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
      return row?.role ?? null;
    } catch (err) {
      this.logger.warn(`Team memberRole failed: ${asMessage(err)}`);
      return null;
    }
  }

  private warnNoDbOnce(): void {
    if (!this.warnedNoDb) {
      this.warnedNoDb = true;
      this.logger.warn("Team service has no database — acting empty");
    }
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
