import { Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service.js";
import { MetricsService } from "../observability/metrics/metrics.service.js";
import type { CreateTaskDto } from "./dto/create-task.dto.js";
import type { FailureClassification } from "./dead-letter.js";

export interface TaskStepData {
  stepIndex: number;
  type: "thought" | "tool_call" | "tool_result" | "pending_approval" | "done" | "error";
  content: unknown;
}

/**
 * A tool call awaiting (or granted) human approval — stored on the task's
 * checkpoint while the task is paused (Engine v0.1 approval gate).
 */
export interface TaskApproval {
  plugin: string;
  tool: string;
  args: Record<string, unknown>;
  /** stepIndex of the tool_call step this approval refers to. */
  stepIndex: number;
}

/**
 * CRUD layer for AgentTask, TaskStep, and TaskCheckpoint.
 * All methods degrade gracefully when there is no database (same pattern as
 * SettingsService / AuditService — check `this.prisma.db` before each call).
 */
@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Phase 2.0 2.3 — engine metrics feed (task lifecycle counter). Trailing
    // @Optional(): offline tests construct positionally and stay green.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async create(dto: CreateTaskDto, actorId?: string) {
    const db = this.prisma.db;
    if (!db) throw new Error("Database not available");
    const task = await db.agentTask.create({
      data: {
        title: dto.title,
        prompt: dto.prompt,
        model: dto.model,
        maxSteps: dto.maxSteps ?? 20,
        maxTokens: dto.maxTokens,
        actorId,
        status: "queued",
      },
    });
    this.metrics?.recordTaskLifecycle("submitted");
    return task;
  }

  async findAll() {
    const db = this.prisma.db;
    if (!db) return [];
    return db.agentTask.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, title: true, status: true, model: true, provider: true,
        stepCount: true, maxSteps: true, maxTokens: true, actorId: true, createdAt: true,
        updatedAt: true, startedAt: true, completedAt: true, error: true,
      },
    });
  }

  async findOne(id: string) {
    const db = this.prisma.db;
    if (!db) return null;
    return db.agentTask.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepIndex: "asc" } } },
    });
  }

  async markRunning(id: string, provider?: string) {
    const db = this.prisma.db;
    if (!db) return;
    await db.agentTask.update({
      where: { id },
      data: { status: "running", startedAt: new Date(), provider },
    });
    this.metrics?.recordTaskLifecycle("started");
  }

  /**
   * Record the provider that ACTUALLY served the task (Engine v0.3 — the
   * router picks it: Ollama by default, a cloud provider when the task's
   * model routes there, possibly after a fallback). Called after the first
   * successful model call, so the field reflects reality instead of a
   * hardcoded "ollama".
   */
  async markProvider(id: string, provider: string) {
    const db = this.prisma.db;
    if (!db) return;
    await db.agentTask.update({ where: { id }, data: { provider } });
  }

  async markCompleted(id: string, result: unknown) {
    const db = this.prisma.db;
    if (!db) return;
    await db.agentTask.update({
      where: { id },
      data: { status: "completed", result: result as Prisma.InputJsonValue, completedAt: new Date() },
    });
    this.metrics?.recordTaskLifecycle("completed");
  }

  async markFailed(id: string, error: string, classification?: FailureClassification) {
    const db = this.prisma.db;
    if (!db) return;
    await db.agentTask.update({
      where: { id },
      data: classification
        ? { status: "failed", error, failureClassification: classification, completedAt: new Date() }
        : { status: "failed", error, completedAt: new Date() },
    });
    this.metrics?.recordTaskLifecycle("failed");
  }

  /** Pause a running task (approval gate): status -> "paused". */
  async markPaused(id: string) {
    const db = this.prisma.db;
    if (!db) return;
    await db.agentTask.update({ where: { id }, data: { status: "paused" } });
  }

  /** Put a paused task back in the queue (approval granted). */
  async markQueued(id: string) {
    const db = this.prisma.db;
    if (!db) return;
    await db.agentTask.update({ where: { id }, data: { status: "queued" } });
  }

  async cancel(id: string): Promise<boolean> {
    const db = this.prisma.db;
    if (!db) return false;
    const task = await db.agentTask.findUnique({ where: { id }, select: { status: true } });
    if (!task || !["queued", "running", "paused"].includes(task.status)) return false;
    await db.agentTask.update({
      where: { id },
      data: { status: "cancelled", completedAt: new Date() },
    });
    this.metrics?.recordTaskLifecycle("cancelled");
    return true;
  }

  async addStep(taskId: string, step: TaskStepData) {
    const db = this.prisma.db;
    if (!db) return;
    await db.$transaction([
      db.taskStep.create({
        data: {
          taskId,
          stepIndex: step.stepIndex,
          type: step.type,
          content: step.content as Prisma.InputJsonValue,
        },
      }),
      db.agentTask.update({
        where: { id: taskId },
        data: { stepCount: { increment: 1 } },
      }),
    ]);
  }

  async saveCheckpoint(taskId: string, messages: unknown[], stepIndex: number) {
    const db = this.prisma.db;
    if (!db) return;
    await db.taskCheckpoint.upsert({
      where: { taskId },
      create: { taskId, messages: messages as Prisma.InputJsonValue, stepIndex },
      update: { messages: messages as Prisma.InputJsonValue, stepIndex },
    });
  }

  async loadCheckpoint(taskId: string) {
    const db = this.prisma.db;
    if (!db) return null;
    const cp = await db.taskCheckpoint.findUnique({ where: { taskId } });
    if (!cp) return null;
    return {
      messages: cp.messages as unknown[],
      stepIndex: cp.stepIndex,
      pendingApproval: (cp.pendingApproval as TaskApproval | null) ?? null,
      approvedStepIndex: cp.approvedStepIndex ?? null,
    };
  }

  /**
   * Write the approval-pause state into the checkpoint: the pending tool call
   * plus the next stepIndex to resume at. Clears any prior approval grant.
   */
  async savePendingApproval(taskId: string, messages: unknown[], stepIndex: number, approval: TaskApproval) {
    const db = this.prisma.db;
    if (!db) return;
    await db.taskCheckpoint.upsert({
      where: { taskId },
      create: {
        taskId,
        messages: messages as Prisma.InputJsonValue,
        stepIndex,
        pendingApproval: approval as unknown as Prisma.InputJsonValue,
      },
      update: {
        messages: messages as Prisma.InputJsonValue,
        stepIndex,
        pendingApproval: approval as unknown as Prisma.InputJsonValue,
        approvedStepIndex: null,
      },
    });
  }

  /**
   * Mark the pending tool call approved. Returns the approved stepIndex, or
   * null when there is no pending approval to grant.
   */
  async approvePendingApproval(taskId: string): Promise<number | null> {
    const db = this.prisma.db;
    if (!db) return null;
    const cp = await db.taskCheckpoint.findUnique({ where: { taskId } });
    const pending = cp?.pendingApproval as TaskApproval | null | undefined;
    if (!cp || !pending || typeof pending.stepIndex !== "number") return null;
    await db.taskCheckpoint.update({
      where: { taskId },
      data: { approvedStepIndex: pending.stepIndex },
    });
    return pending.stepIndex;
  }

  /**
   * Clear the approval state after the worker has honoured it (the "honour
   * ONCE" semantics of the gate) and record the post-execution messages.
   */
  async clearApproval(taskId: string, messages: unknown[], stepIndex: number) {
    const db = this.prisma.db;
    if (!db) return;
    await db.taskCheckpoint.update({
      where: { taskId },
      data: {
        messages: messages as Prisma.InputJsonValue,
        stepIndex,
        // SQL NULL (Prisma.DbNull) — not JSON null — so the checkpoint's
        // "no approval pending" state round-trips as a genuine null.
        pendingApproval: Prisma.DbNull,
        approvedStepIndex: null,
      },
    });
  }

  async isCancelled(id: string): Promise<boolean> {
    const db = this.prisma.db;
    if (!db) return false;
    const task = await db.agentTask.findUnique({ where: { id }, select: { status: true } });
    return task?.status === "cancelled";
  }

  /**
   * Engine v0.5 — dead-letter view. Returns FAILED tasks (the structured DLQ),
   * newest-first, capped at `limit`. Each row carries the failure
   * classification + final error so operators can see WHY a task died without
   * consulting BullMQ (whose failed jobs are removed shortly after failing).
   */
  async findAllFailed(limit = 100) {
    const db = this.prisma.db;
    if (!db) return [];
    return db.agentTask.findMany({
      where: { status: "failed" },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        status: true,
        model: true,
        provider: true,
        stepCount: true,
        actorId: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        error: true,
        failureClassification: true,
      },
    });
  }

  /** Count of FAILED task rows — the durable DLQ count, distinct from BullMQ's failed-JOB count. */
  async getFailedCount(): Promise<number> {
    const db = this.prisma.db;
    if (!db) return 0;
    return db.agentTask.count({ where: { status: "failed" } });
  }

  /**
   * Engine v0.5 — supervisor. Find tasks stuck in `running` whose `updatedAt`
   * is older than `staleBefore` (no step progress for too long). The supervisor
   * then decides, per task, whether to re-enqueue or fail it as `stalled`.
   */
  async findStaleRunning(staleBefore: Date) {
    const db = this.prisma.db;
    if (!db) return [];
    return db.agentTask.findMany({
      where: { status: "running", updatedAt: { lt: staleBefore } },
      orderBy: { updatedAt: "asc" },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        error: true,
        failureClassification: true,
        stallRetried: true,
        stepCount: true,
      },
    });
  }

  /**
   * Engine v0.5 — supervisor resume-once flag. Marks a running/queued task as
   * "already resumed once" so a second stale occurrence is NOT re-enqueued
   * again (nothing spins forever — it becomes a `stalled` dead letter).
   */
  async markStallRetried(id: string): Promise<boolean> {
    const db = this.prisma.db;
    if (!db) return false;
    await db.agentTask.update({ where: { id }, data: { stallRetried: true } });
    return true;
  }

  /**
   * Engine v0.5 — a supervising re-enqueue makes the task runnable again and
   * leaves the resume-once marker in place (the NEXT stale occurrence, if any,
   * becomes `stalled`). No status gate: the worker re-reads via checkpoint.
   */
  async markResumed(id: string): Promise<boolean> {
    const db = this.prisma.db;
    if (!db) return false;
    await db.agentTask.update({ where: { id }, data: { status: "queued" } });
    return true;
  }
}
