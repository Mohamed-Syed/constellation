import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { PluginRegistryService } from "../plugins/plugin-registry.service.js";
import { PluginToolService } from "../plugins/plugin-tool.service.js";
import type { ChatMessage } from "./model-router.service.js";
import { ModelRouterService } from "./model-router.service.js";
import { EngineAvailabilityService } from "./engine-availability.service.js";
import { buildRedisConnectionOptions } from "./redis-connection.js";
import { ENGINE_QUEUE_NAME } from "./task-queue.service.js";
import { TaskService } from "./task.service.js";

interface AgentAction {
  type: "thought" | "tool_call" | "done" | "error";
  thought?: string;
  plugin?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
}

/**
 * The engine agent's privilege. The autonomous agent is the most privileged
 * caller in the system — it can invoke ANY tool any plugin declares — so its
 * permission set is centralized HERE as the single seam to scope down later
 * (e.g. give the agent a dedicated "engine:agent" role holding only the
 * permissions the loop genuinely needs, instead of platform:admin). The
 * approval gate (per-tool `requiresApproval` / global
 * `ENGINE_REQUIRE_APPROVAL_ALL`) is the real guardrail; this constant just
 * makes the privilege honest and auditable in one place.
 */
export const ENGINE_AGENT_PERMISSIONS = ["platform:admin"] as const;

/**
 * BullMQ Worker that drives the autonomous agent loop.
 *
 * Loop design (ReAct style):
 *  1. Build a tool catalogue from the currently-enabled plugins.
 *  2. Send the system prompt + task prompt + prior conversation to the model.
 *  3. Parse the model's JSON response into an AgentAction.
 *  4. Execute tool_call actions via PluginToolService (trusted internal caller).
 *  5. Append each step to TaskStep table and write a TaskCheckpoint.
 *  6. On restart, reload from checkpoint and continue — no steps are re-run.
 *  7. Finish when type === "done", stepCount >= maxSteps, or task is cancelled.
 *
 * The worker is created on module init and closed on module destroy so NestJS
 * teardown does not leave open Redis connections.
 */
@Injectable()
export class AgentWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentWorkerService.name);
  private worker: Worker | undefined;
  private readonly connection: ReturnType<typeof buildRedisConnectionOptions>;
  /** Global supervised-mode switch: when true, EVERY tool call requires approval. */
  private readonly approveAll: boolean;

  constructor(
    private readonly taskService: TaskService,
    private readonly modelRouter: ModelRouterService,
    private readonly pluginTool: PluginToolService,
    private readonly registry: PluginRegistryService,
    private readonly config: ConfigService,
    private readonly availability: EngineAvailabilityService,
  ) {
    this.connection = buildRedisConnectionOptions(config.get("REDIS_URL", "redis://localhost:6379"));
    this.approveAll = config.get("ENGINE_REQUIRE_APPROVAL_ALL", "false") === "true";
  }

  async onModuleInit() {
    // Same ordering note as TaskQueueService: ensureProbed() triggers the
    // shared single Redis probe so the verdict is ready before we decide.
    await this.availability.ensureProbed();
    if (!this.availability.isEnabled) {
      this.logger.warn(`AgentWorker NOT started — ${this.availability.reason}`);
      return;
    }

    this.worker = new Worker(
      ENGINE_QUEUE_NAME,
      (job: Job<{ taskId: string }>) => this.processJob(job),
      { connection: this.connection as ConnectionOptions, concurrency: 2 },
    );

    this.worker.on("completed", (job) => {
      this.logger.log(`Job ${job.id} (task ${job.data.taskId}) completed`);
    });

    this.worker.on("failed", (job, err) => {
      this.logger.error(`Job ${job?.id} (task ${job?.data?.taskId}) failed: ${err.message}`);
      if (job?.data?.taskId) {
        void this.taskService.markFailed(job.data.taskId, err.message);
      }
    });

    this.logger.log("AgentWorker started");
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async processJob(job: Job<{ taskId: string }>): Promise<void> {
    const { taskId } = job.data;
    const task = await this.taskService.findOne(taskId);
    if (!task) {
      this.logger.warn(`Task ${taskId} not found — skipping job`);
      return;
    }

    if (task.status === "cancelled") {
      this.logger.log(`Task ${taskId} already cancelled — skipping`);
      return;
    }

    // ── Attempt to resume from checkpoint ──────────────────────────────────
    let checkpoint = await this.taskService.loadCheckpoint(taskId);
    let messages: ChatMessage[];
    let stepIndex: number;

    if (checkpoint) {
      this.logger.log(`Task ${taskId}: resuming from step ${checkpoint.stepIndex}`);
      messages = checkpoint.messages as ChatMessage[];
      stepIndex = checkpoint.stepIndex;
    } else {
      messages = [
        { role: "system", content: this.buildSystemPrompt() },
        { role: "user", content: task.prompt },
      ];
      stepIndex = 0;
    }

    // ── Mark running ───────────────────────────────────────────────────────
    await this.taskService.markRunning(taskId, "ollama");

    const maxSteps = task.maxSteps ?? 20;

    // ── Agent loop ─────────────────────────────────────────────────────────
    while (stepIndex < maxSteps) {
      // Cancellation check — poll each iteration
      if (await this.taskService.isCancelled(taskId)) {
        this.logger.log(`Task ${taskId} cancelled mid-run at step ${stepIndex}`);
        return;
      }

      // ── Approved-pending-approval: execute the just-approved tool call ───
      // Resume path after POST /api/engine/tasks/:id/approve. The tool_call
      // step + pending_approval step were recorded when the task paused; the
      // checkpoint carries the approval. Execute it directly (NO model call —
      // the model has nothing new to decide) and honour the grant ONCE.
      if (checkpoint?.approvedStepIndex != null && checkpoint?.pendingApproval) {
        const approval = checkpoint.pendingApproval;
        if (approval.stepIndex === checkpoint.approvedStepIndex) {
          this.logger.log(
            `Task ${taskId}: executing APPROVED tool call ${approval.plugin}.${approval.tool} (step ${approval.stepIndex})`,
          );
          const nextFree = await this.executeToolCall(
            taskId,
            approval.plugin,
            approval.tool,
            approval.args ?? {},
            messages,
            stepIndex,
            false, // the tool_call step already exists (written when paused)
          );
          // The approval is honoured — persist the cleared state and the next
          // free index so a later restart continues cleanly. `continue`
          // skips the loop-bottom stepIndex++/saveCheckpoint, so set the
          // index here.
          stepIndex = nextFree;
          await this.taskService.clearApproval(taskId, messages, nextFree);
          checkpoint = null; // honour once — do not re-check this approval
          continue;
        }
      }

      // ── Call model ──────────────────────────────────────────────────────
      let rawResponse: string;
      try {
        const response = await this.modelRouter.chat(messages, task.model ?? undefined);
        rawResponse = response.content;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.taskService.addStep(taskId, { stepIndex, type: "error", content: { error: msg } });
        await this.taskService.markFailed(taskId, msg);
        return;
      }

      // ── Parse action ────────────────────────────────────────────────────
      const action = this.parseAction(rawResponse);

      // Append model response to conversation
      messages.push({ role: "assistant", content: rawResponse });

      // ── Dispatch ────────────────────────────────────────────────────────
      if (action.type === "thought") {
        await this.taskService.addStep(taskId, {
          stepIndex,
          type: "thought",
          content: { thought: action.thought ?? rawResponse },
        });
        messages.push({ role: "user", content: "Continue." });

      } else if (action.type === "tool_call" && action.plugin && action.tool) {
        // ── Approval gate (Engine v0.1): pause for a human before running ──
        if (this.requiresApproval(action.plugin, action.tool)) {
          await this.pauseForApproval(taskId, action, messages, stepIndex);
          return; // release the BullMQ job — the task waits for approve/reject
        }
        // executeToolCall writes TWO steps (tool_call + tool_result) and
        // returns the next free index; the loop-bottom ++ then lands the
        // following step one past the tool_result.
        const nextFree = await this.executeToolCall(
          taskId,
          action.plugin,
          action.tool,
          action.args ?? {},
          messages,
          stepIndex,
          true,
        );
        stepIndex = nextFree - 1;

      } else if (action.type === "done") {
        await this.taskService.addStep(taskId, {
          stepIndex,
          type: "done",
          content: { result: action.result ?? rawResponse },
        });
        await this.taskService.markCompleted(taskId, { summary: action.result ?? rawResponse });
        return;

      } else {
        // Unparseable or unknown — treat as a thought and carry on
        await this.taskService.addStep(taskId, {
          stepIndex,
          type: "thought",
          content: { raw: rawResponse },
        });
        messages.push({ role: "user", content: "Continue toward completing the task." });
      }

      stepIndex++;
      await this.taskService.saveCheckpoint(taskId, messages, stepIndex);
    }

    // Ran out of steps
    await this.taskService.markFailed(taskId, `Reached max steps (${maxSteps}) without completing.`);
  }

  /**
   * Run one tool call and append its result step + conversation message.
   * Returns the NEXT FREE step index (one past the tool_result step), so the
   * caller's loop accounting stays aligned with the step history.
   *
   * `recordCallStep` is true on the normal path (the tool_call step does not
   * exist yet — the caller passed the tool_call stepIndex); false on the
   * approve-resume path (the tool_call step was recorded when the task
   * paused, and `stepIndex` is already the index AFTER it — past the
   * pending_approval marker). In BOTH cases the tool_result step lands one
   * index past the passed `stepIndex`, keeping indexes unique and ascending.
   */
  private async executeToolCall(
    taskId: string,
    plugin: string,
    tool: string,
    args: Record<string, unknown>,
    messages: ChatMessage[],
    stepIndex: number,
    recordCallStep: boolean,
  ): Promise<number> {
    if (recordCallStep) {
      await this.taskService.addStep(taskId, {
        stepIndex,
        type: "tool_call",
        content: { plugin, tool, args },
      });
      // Checkpoint BEFORE the invoke so a crash mid-call resumes from here.
      await this.taskService.saveCheckpoint(taskId, messages, stepIndex + 1);
    }

    const invocation = await this.pluginTool.invoke(plugin, tool, args, ENGINE_AGENT_PERMISSIONS);

    const toolResult =
      invocation.outcome === "completed"
        ? invocation.result
        : { ok: false, error: invocation.message };

    const resultIndex = stepIndex + 1;
    await this.taskService.addStep(taskId, {
      stepIndex: resultIndex,
      type: "tool_result",
      content: toolResult,
    });

    messages.push({
      role: "user",
      content: `Tool result: ${JSON.stringify(toolResult)}`,
    });

    return resultIndex + 1;
  }

  /**
   * HUMAN-IN-THE-LOOP pause: the agent chose a tool that requires approval.
   * Record the tool_call + a pending_approval step, write the pending state
   * onto the checkpoint, set the task to "paused", and STOP (the caller
   * returns so the BullMQ job is released — nothing has run). A human then
   * POSTs /api/engine/tasks/:id/approve (executes the call) or /reject
   * (fails the task).
   */
  private async pauseForApproval(
    taskId: string,
    action: AgentAction,
    messages: ChatMessage[],
    stepIndex: number,
  ): Promise<void> {
    const plugin = action.plugin!;
    const tool = action.tool!;
    const args = action.args ?? {};

    // The tool_call step makes the request auditable in the step history.
    await this.taskService.addStep(taskId, {
      stepIndex,
      type: "tool_call",
      content: { plugin, tool, args },
    });

    const nextIndex = stepIndex + 1;
    await this.taskService.savePendingApproval(taskId, messages, nextIndex, { plugin, tool, args, stepIndex });
    await this.taskService.addStep(taskId, {
      stepIndex: nextIndex,
      type: "pending_approval",
      content: { plugin, tool, args },
    });
    await this.taskService.markPaused(taskId);

    this.logger.warn(`Task ${taskId} paused at step ${stepIndex} — awaiting approval for ${plugin}.${tool}`);
  }

  /**
   * Whether the agent's tool call must wait for a human decision first:
   * the global ENGINE_REQUIRE_APPROVAL_ALL switch (supervised mode — EVERY
   * tool call) OR the tool's own manifest `requiresApproval` flag (v2).
   */
  private requiresApproval(pluginId: string, toolName: string): boolean {
    if (this.approveAll) return true;
    const tool = this.registry.get(pluginId)?.manifest.tools.find((t) => t.name === toolName);
    return tool?.requiresApproval === true;
  }

  private parseAction(raw: string): AgentAction {
    // Extract the FIRST balanced JSON object from the model response. A naive
    // greedy `/\{[\s\S]*\}/` grabs from the first `{` to the LAST `}` — if a
    // (smaller, less instruction-followed) model emits several JSON objects
    // in one reply (e.g. inside a single code fence), that span is not valid
    // JSON and every step silently degrades to "thought", so the loop can
    // never dispatch a tool_call or reach done. Brace-counting finds the
    // first *complete* object and ignores anything the model appended after.
    const jsonText = extractFirstJsonObject(raw);
    if (!jsonText) return { type: "thought", thought: raw };

    try {
      const obj = JSON.parse(jsonText) as Partial<AgentAction>;
      if (obj.type && ["thought", "tool_call", "done", "error"].includes(obj.type)) {
        return obj as AgentAction;
      }
    } catch {
      // not valid JSON
    }

    return { type: "thought", thought: raw };
  }

  private buildSystemPrompt(): string {
    const plugins = this.registry.all().filter((p) => p.state === "enabled");
    const toolLines = plugins.flatMap((p) =>
      (p.manifest.tools ?? []).map(
        (t) => `  - plugin="${p.manifest.id}" tool="${t.name}": ${t.description ?? "no description"}`,
      ),
    );

    const toolSection =
      toolLines.length > 0
        ? `Available tools:\n${toolLines.join("\n")}`
        : "No plugin tools are currently available.";

    return `You are an autonomous agent for the Constellation platform.
You complete tasks step-by-step using available plugin tools.

${toolSection}

For EVERY response, output ONLY a valid JSON object — no other text:

To think:
{"type":"thought","thought":"<your reasoning>"}

To call a tool:
{"type":"tool_call","plugin":"<pluginId>","tool":"<toolName>","args":{...}}

When the task is finished:
{"type":"done","result":"<summary of what was accomplished>"}

Rules:
- Output EXACTLY ONE JSON object per response — never multiple objects, never a
  plan of several steps at once. One action, then wait for the result.
- Do not wrap the JSON in a code fence or add any text before or after it.
- Do not hallucinate tool names — use only the tools listed above.
- After receiving a tool result, decide the next single action.
- Be concise and task-focused.`;
  }
}

/**
 * Finds the first balanced `{...}` object in `text` by brace-counting, so a
 * model that emits several JSON objects in one reply (ignoring the "exactly
 * one" instruction) still yields a parseable first action instead of an
 * invalid multi-object span. Returns `null` if no `{` is found or braces
 * never balance (truncated/malformed output).
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}
