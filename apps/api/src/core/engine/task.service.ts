import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service.js";
import type { CreateTaskDto } from "./dto/create-task.dto.js";

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

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTaskDto, actorId?: string) {
    const db = this.prisma.db;
    if (!db) throw new Error("Database not available");
    return db.agentTask.create({
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
  }

  async markCompleted(id: string, result: unknown) {
    const db = this.prisma.db;
    if (!db) return;
    await db.agentTask.update({
      where: { id },
      data: { status: "completed", result: result as Prisma.InputJsonValue, completedAt: new Date() },
    });
  }

  async markFailed(id: string, error: string) {
    const db = this.prisma.db;
    if (!db) return;
    await db.agentTask.update({
      where: { id },
      data: { status: "failed", error, completedAt: new Date() },
    });
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
}
