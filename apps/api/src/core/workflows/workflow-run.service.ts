import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { TaskQueueService } from "../engine/task-queue.service.js";
import { TaskService } from "../engine/task.service.js";
import { PluginToolService } from "../plugins/plugin-tool.service.js";
import { WorkflowService } from "./workflow.service.js";
import { renderTemplates, type WorkflowDefinition, type WorkflowStep } from "./workflow.schema.js";

export interface WorkflowStepOutcome {
  id: string;
  kind: "agent" | "tool";
  label: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  taskId?: string;
  durationMs: number;
}

/**
 * Phase 3.0 — the workflow RUN EXECUTOR.
 *
 * Executes a stored definition top-to-bottom:
 *   - "agent" steps: TaskService.create + TaskQueueService.enqueue, then poll
 *     the task until terminal (bounded). The step result is the task's result.
 *   - "tool" steps: PluginToolService.invoke (trusted system caller) — the
 *     step result is the tool's result payload.
 * Steps may reference earlier steps via {{steps.<id>.result|error}}.
 *
 * Every run is persisted (WorkflowRun with a per-step outcome trail) so a
 * failed run shows exactly where it stopped. All steps are executed in the
 * api process; the engine worker (embedded or separate) picks up agent steps
 * from the shared queue as usual.
 *
 * TESTABILITY: `executeDefinition` takes the definition + a `waitForTask`
 * seam (default: real poll); tests inject a fake so no real queue/worker is
 * needed. `renderTemplates` is covered separately.
 */
@Injectable()
export class WorkflowRunService {
  private readonly logger = new Logger(WorkflowRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowService,
    private readonly tasks: TaskService,
    private readonly queue: TaskQueueService,
    private readonly tools: PluginToolService,
  ) {}

  /** Default task poll: every 1s up to 10 minutes. Injectable for tests. */
  waitForTask: (taskId: string) => Promise<{ status: string; result?: unknown; error?: string | null }> =
    async (taskId) => {
      const deadline = Date.now() + 10 * 60 * 1000;
      for (;;) {
        const task = await this.tasks.findOne(taskId);
        if (!task) return { status: "failed", error: "task disappeared" };
        if (["completed", "failed", "cancelled"].includes(task.status)) {
          return { status: task.status, result: task.result ?? undefined, error: task.error };
        }
        if (Date.now() > deadline) return { status: "failed", error: "timed out waiting for agent step" };
        await new Promise((r) => setTimeout(r, 1000));
      }
    };

  /** Run a stored workflow (manual trigger). Returns the created run row. */
  async run(workflowId: string) {
    const db = this.prisma.db;
    if (!db) throw new Error("Database not available");
    const { name, definition } = await this.workflows.getValidated(workflowId);

    const run = await db.workflowRun.create({
      data: { workflowId, status: "running" },
    });

    // Fire-and-forget execution so the HTTP call returns the run id fast.
    void this.executeRun(run.id, name, definition);
    return run;
  }

  /** Execute a definition and write the outcome trail onto the run row. */
  async executeRun(runId: string, name: string, definition: WorkflowDefinition): Promise<void> {
    const db = this.prisma.db;
    const outcomes = new Map<string, WorkflowStepOutcome>();
    const trail: WorkflowStepOutcome[] = [];
    let error: string | undefined;

    try {
      for (const step of definition.steps) {
        const outcome = await this.executeStep(step, outcomes);
        outcomes.set(step.id, outcome);
        trail.push(outcome);
        // Persist the partial trail after each step — a crash mid-run still
        // leaves an honest record of how far it got.
        if (db) {
          await db.workflowRun.update({
            where: { id: runId },
            data: { stepsResult: trail as unknown as object },
          });
        }
        if (!outcome.ok) {
          error = `Step "${step.id}" (${step.label}) failed: ${outcome.error ?? "unknown error"}`;
          break;
        }
      }
    } catch (err) {
      error = `Workflow run aborted: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(error);
    }

    if (db) {
      await db.workflowRun.update({
        where: { id: runId },
        data: {
          status: error ? "failed" : "completed",
          stepsResult: trail as unknown as object,
          error,
          completedAt: new Date(),
        },
      });
    }
    this.logger.log(
      `Workflow "${name}" run ${runId}: ${error ? "failed — " + error : `completed (${trail.length} steps)`}`,
    );
  }

  private async executeStep(
    step: WorkflowStep,
    outcomes: Map<string, WorkflowStepOutcome>,
  ): Promise<WorkflowStepOutcome> {
    const label = step.label ?? step.id;
    const started = Date.now();
    if (step.kind === "agent") {
      const prompt = renderTemplates(step.prompt, outcomes);
      const task = await this.tasks.create({
        title: `Workflow step — ${label}`,
        prompt,
        model: step.model,
        maxSteps: step.maxSteps ?? 20,
      });
      await this.queue.enqueue(task.id);
      const final = await this.waitForTask(task.id);
      return {
        id: step.id,
        kind: "agent",
        label,
        ok: final.status === "completed",
        result: final.result,
        error: final.error ?? undefined,
        taskId: task.id,
        durationMs: Date.now() - started,
      };
    }

    // "tool" step — trusted system caller (same posture as the agent worker).
    const args = renderTemplatesJson(step.args, outcomes);
    const invocation = await this.tools.invoke(step.plugin, step.tool, args, ["platform:admin"]);
    // NOTE: the completed envelope's outcome is "completed" (NOT "ok" — that
    // was a real live bug: every tool step was marked failed). Rejections
    // carry reason/message and NO result key — surface them as the error.
    const ok = invocation.outcome === "completed" && invocation.result.ok === true;
    // ToolResult envelopes vary per plugin: some carry `result`, some `data`
    // (graphify). Capture either so later steps can reference the payload.
    const payload = ok ? (invocation.result.result ?? (invocation.result as { data?: unknown }).data) : undefined;
    return {
      id: step.id,
      kind: "tool",
      label,
      ok,
      result: payload,
      error: ok
        ? undefined
        : invocation.outcome === "rejected"
          ? `${invocation.reason}: ${invocation.message}`
          : String(invocation.result.error ?? "tool call failed"),
      durationMs: Date.now() - started,
    };
  }

  /** Resolve an existing run row for the history route. */
  async findRun(runId: string) {
    const db = this.prisma.db;
    if (!db) return null;
    const run = await db.workflowRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException(`Workflow run "${runId}" not found`);
    return run;
  }
}

/** Render {{...}} placeholders inside a tool-args object (values only). */
function renderTemplatesJson(
  args: Record<string, unknown> | undefined,
  outcomes: Map<string, WorkflowStepOutcome>,
): Record<string, unknown> {
  if (!args) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      out[key] = renderTemplates(value, outcomes);
    } else {
      out[key] = value;
    }
  }
  return out;
}
