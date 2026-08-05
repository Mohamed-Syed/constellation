import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { TaskService } from "./task.service.js"; // value imports — DI metadata (trap #3)
import { TaskQueueService } from "./task-queue.service.js";

export interface DelegateChildInput {
  title: string;
  prompt: string;
  model?: string;
  maxSteps?: number;
  teamId?: string;
}

export interface DelegationTreeNode {
  id: string;
  title: string;
  status: string;
  provider: string | null;
  model: string | null;
  actorId: string | null;
  stepCount: number;
  totalTokens: number | null;
  costUSD: number | null;
  createdAt: string;
  completedAt: string | null;
  children: DelegationTreeNode[];
}

const TREE_MAX_DEPTH = 4;
const TREE_MAX_NODES = 50;

/**
 * Crews round (Phase 4.0 4.1) — TASK DELEGATION.
 *
 * An orchestrator task can spawn sub-agent tasks (children) and wait for
 * their results: `spawnChild` links a new task to a parent via
 * `AgentTask.parentTaskId`; `tree` materializes the delegation tree; and
 * `waitForChildren` lets an orchestrator block until every descendant is
 * terminal. The delegation graph is DURABLE (a column, not an in-memory map):
 * children survive restarts and are visible to anyone who can see the parent.
 *
 * Access control reuses the team-spaces model: a caller may delegate under a
 * task only when they own it (actorId match) or are a platform admin, or are
 * a member of the task's team with the team's manage scope. Enforcement is
 * done by the controller via TeamService.canManage-style checks; this service
 * stays DB-only and degrades to empty/no-op results without a DB.
 */
@Injectable()
export class DelegationService {
  private readonly logger = new Logger(DelegationService.name);
  private warnedNoDb = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskService,
    private readonly queue: TaskQueueService,
  ) {}

  private warnNoDbOnce(): void {
    if (!this.warnedNoDb) {
      this.warnedNoDb = true;
      this.logger.warn("DelegationService: no database — delegation degrades to empty/no-op.");
    }
  }

  /** Create a child task under `parentId`. Returns the child row. */
  async spawnChild(parentId: string, input: DelegateChildInput): Promise<Record<string, unknown> | null> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return null;
    }
    const parent = await db.agentTask.findUnique({ where: { id: parentId } });
    if (!parent) return null;
    // Any EXISTING task can spawn children — a finished orchestrator can still
    // grow its crew (the tree is durable); children are independent tasks.

    const child = await this.tasks.create(
      {
        title: input.title,
        prompt: input.prompt,
        model: input.model,
        maxSteps: input.maxSteps ?? Math.max(3, (parent.maxSteps ?? 20) - 2),
        maxTokens: parent.maxTokens ?? undefined,
        teamId: input.teamId ?? parent.teamId ?? undefined,
      },
      parent.actorId ?? undefined,
    );
    if (!child) return null;

    await db.agentTask.update({ where: { id: child.id }, data: { parentTaskId: parentId } });
    await this.queue.enqueue(child.id);
    return this.toRow(child);
  }

  /** Direct children of a task, newest first. */
  async childrenOf(parentId: string): Promise<Record<string, unknown>[]> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return [];
    }
    const rows = await db.agentTask.findMany({
      where: { parentTaskId: parentId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toRow(r));
  }

  /** Full delegation tree (children of children), depth- and node-bounded. */
  async tree(parentId: string): Promise<DelegationTreeNode> {
    const db = this.prisma.db;
    if (!db) {
      this.warnNoDbOnce();
      return { id: parentId, title: "", status: "unknown", provider: null, model: null, actorId: null, stepCount: 0, totalTokens: null, costUSD: null, createdAt: "", completedAt: null, children: [] };
    }
    const root = await db.agentTask.findUnique({ where: { id: parentId } });
    if (!root) {
      return { id: parentId, title: "", status: "unknown", provider: null, model: null, actorId: null, stepCount: 0, totalTokens: null, costUSD: null, createdAt: "", completedAt: null, children: [] };
    }
    let budget = TREE_MAX_NODES;
    const walk = async (id: string, depth: number): Promise<DelegationTreeNode> => {
      const row = await db.agentTask.findUnique({ where: { id } });
      const node = this.toNode(row);
      if (depth >= TREE_MAX_DEPTH || budget <= 0) return node;
      const kids = await db.agentTask.findMany({ where: { parentTaskId: id }, orderBy: { createdAt: "asc" } });
      for (const kid of kids) {
        if (budget <= 0) break;
        budget -= 1;
        node.children.push(await walk(kid.id, depth + 1));
      }
      return node;
    };
    return walk(parentId, 0);
  }

  /**
   * Wait until every descendant of `parentId` is terminal (completed /
   * failed / cancelled) or the deadline passes. Returns a summary.
   */
  async waitForChildren(
    parentId: string,
    options: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<{ ok: boolean; pending: number; done: number; timedOut: boolean; children: Record<string, unknown>[] }> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const pollMs = options.pollMs ?? 2_500;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const children = await this.childrenOf(parentId);
      const pending = children.filter((c) => !["completed", "failed", "cancelled"].includes(String(c.status)));
      const done = children.length - pending.length;
      if (pending.length === 0 || Date.now() >= deadline) {
        return { ok: pending.length === 0, pending: pending.length, done, timedOut: pending.length > 0, children };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  /** Terminal statuses only. */
  isTerminal(status: string): boolean {
    return status === "completed" || status === "failed" || status === "cancelled";
  }

  private toRow(row: unknown): Record<string, unknown> {
    const r = row as Record<string, unknown>;
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      provider: r.provider ?? null,
      model: r.model ?? null,
      actorId: r.actorId ?? null,
      stepCount: r.stepCount ?? 0,
      totalTokens: r.totalTokens ?? null,
      costUSD: r.costUSD ?? null,
      parentTaskId: r.parentTaskId ?? null,
      teamId: r.teamId ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      completedAt: r.completedAt instanceof Date ? r.completedAt.toISOString() : (r.completedAt ?? null),
    };
  }

  private toNode(row: unknown): DelegationTreeNode {
    const r = this.toRow(row);
    return {
      id: String(r.id),
      title: String(r.title),
      status: String(r.status),
      provider: r.provider === null ? null : String(r.provider),
      model: r.model === null ? null : String(r.model),
      actorId: r.actorId === null ? null : String(r.actorId),
      stepCount: Number(r.stepCount),
      totalTokens: r.totalTokens === null ? null : Number(r.totalTokens),
      costUSD: r.costUSD === null ? null : Number(r.costUSD),
      createdAt: String(r.createdAt),
      completedAt: r.completedAt === null ? null : String(r.completedAt),
      children: [],
    };
  }
}
