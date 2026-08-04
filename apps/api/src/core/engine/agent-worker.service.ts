import { Injectable, Inject, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { PluginRegistryService } from "../plugins/plugin-registry.service.js";
import { PluginToolService } from "../plugins/plugin-tool.service.js";
import { ModelCallError, TokenBudget, retryTransient } from "./model-provider.js";
import type { ChatMessage } from "./model-router.service.js";
import { ModelRouterService } from "./model-router.service.js";
import { EngineAvailabilityService } from "./engine-availability.service.js";
import { EngineAlertService } from "./engine-alerts.service.js";
import { engineLoopsRunHere } from "./engine-worker-role.js";
import type { FailureClassification } from "./dead-letter.js";
import { buildRedisConnectionOptions } from "./redis-connection.js";
import { ENGINE_QUEUE_NAME } from "./task-queue.service.js";
import { TaskService } from "./task.service.js";
// VALUE import (not `import type`): TracingService is used as a DI token below,
// and a type-only import would be erased, leaving design:paramtypes = Function
// so @Optional() silently injects undefined — the engine spans would never exist.
import { TracingService } from "../observability/tracing/tracing.service.js";

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
  /** Default per-task token ceiling (overridable per task via `maxTokens`). */
  private readonly defaultTokenBudget: number;
  /** Bounded retries for TRANSIENT model-call failures (Ollama hiccups). */
  private readonly modelRetries: number;

  constructor(
    private readonly taskService: TaskService,
    private readonly modelRouter: ModelRouterService,
    private readonly pluginTool: PluginToolService,
    private readonly registry: PluginRegistryService,
    private readonly config: ConfigService,
    private readonly availability: EngineAvailabilityService,
    private readonly alerts: EngineAlertService,
    @Optional() @Inject(TracingService) private readonly tracing?: TracingService,
  ) {
    this.connection = buildRedisConnectionOptions(config.get("REDIS_URL", "redis://localhost:6379"));
    this.approveAll = config.get("ENGINE_REQUIRE_APPROVAL_ALL", "false") === "true";
    this.defaultTokenBudget = Number(config.get("ENGINE_MAX_TOKENS_PER_TASK", "100000"));
    this.modelRetries = Number(config.get("ENGINE_MODEL_RETRIES", "3"));
  }

  async onModuleInit() {
    // Phase 2.0 2.8 — separate worker mode: the loop runs in the dedicated
    // worker process, never in the api. Defer with an honest log.
    if (!engineLoopsRunHere()) {
      this.logger.warn(`AgentWorker NOT started here — deferred to the worker process (ENGINE_WORKER_MODE=separate)`);
      return;
    }
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
        // A BullMQ job that failed (after exhausting its `attempts:3` retries)
        // is a TERMINAL dead letter — it must not be re-enqueued forever. The
        // durable task row carries the classification + accumulated error.
        const taskId = job.data.taskId as string;
        void this.markTaskFailed(taskId, err.message, "terminal");
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

    // ── Trace the whole run (additive — no-op when tracing is disabled) ──
    // The run span covers the full loop: model calls, tool invocations,
    // checkpoints, and every exit path (done/failed/cancelled/paused).
    await this.trace(
      "engine.task.run",
      { "task.id": taskId, "task.title": task.title ?? "", "task.model": task.model ?? "" },
      () => this.runTask(task, taskId),
    );
  }

  /** Run `fn` inside an OTel span when tracing is enabled; plain `fn()` otherwise. */
  private trace<T>(name: string, attributes: Record<string, string>, fn: () => Promise<T>): Promise<T> {
    if (!this.tracing) return fn();
    return this.tracing.withSpan(name, attributes, fn);
  }

  /**
   * The agent loop body (extracted from processJob so the run can be traced).
   * Completes/fails/cancels/pauses — the returns inside the loop flow through
   * the caller's span, which always ends.
   */
  private async runTask(task: NonNullable<Awaited<ReturnType<TaskService["findOne"]>>>, taskId: string): Promise<void> {
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
    // Provider is NOT known yet — the router picks it (Ollama by default, a
    // cloud provider when the task's model routes there, possibly after a
    // fallback). Mark running without a provider; the REAL one is recorded
    // after the first successful model call (Engine v0.3 — no dishonest
    // hardcoded "ollama").
    await this.taskService.markRunning(taskId);

    const maxSteps = task.maxSteps ?? 20;
    // Hard per-task token ceiling (Engine v0.1 Task 3): the "budget cap" the
    // design promised. Every model call's usage is recorded against this;
    // when the cumulative count crosses it the task stops with an honest
    // terminal error (a paid provider would enforce a dollar-cap the same
    // way, via the same tracker — see TokenBudget in model-provider.ts).
    const budget = new TokenBudget(task.maxTokens ?? this.defaultTokenBudget);
    // Record the task-level provider once, after the first model call
    // resolves — the router's choice (Ollama or a cloud provider) is only
    // knowable then (Engine v0.3).
    let providerRecorded = false;

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
      // Transient failures (network blips, 5xx, timeouts) are retried a
      // bounded number of times with small backoff — a 1s Ollama hiccup must
      // not kill a long task (Engine v0.1 Task 5). Terminal failures (4xx,
      // unknown model) and retries exhausted fall through to markFailed.
      let rawResponse: string;
      try {
        // One span per agent step — the model call (with its bounded retries)
        // is the step's substance; model.call / plugin.tool.invoke spans
        // parent under it (additive — no-op when tracing is disabled).
        const response = await this.trace(
          "engine.task.step",
          { "task.id": taskId, "step.index": String(stepIndex), "task.model": task.model ?? "" },
          () =>
            retryTransient(
              () => this.modelRouter.chat(messages, task.model ?? undefined),
              {
                maxAttempts: this.modelRetries,
                delayMs: (attempt) => Math.min(500 * (attempt + 1), 2000),
              },
            ),
        );
        rawResponse = response.content;

        // Record the ACTUAL provider on the task (once) — the router may
        // have used a cloud provider or fallen back; the field must reflect
        // reality, not a hardcoded default (Engine v0.3).
        if (!providerRecorded) {
          providerRecorded = true;
          await this.taskService.markProvider(taskId, response.provider);
        }

        // Token budget: stop the task (honest terminal failure) the moment
        // the ceiling is crossed — no unbounded spend on a runaway loop.
        if (!budget.record(response.usage)) {
          const msg = `Token budget exhausted: used ${budget.used} of ${budget.ceiling} tokens`;
          await this.taskService.addStep(taskId, { stepIndex, type: "error", content: { error: msg } });
          await this.markTaskFailed(taskId, msg, "terminal");
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.taskService.addStep(taskId, { stepIndex, type: "error", content: { error: msg } });
        await this.markTaskFailed(taskId, msg, this.classifyModelError(err));
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
    await this.markTaskFailed(taskId, `Reached max steps (${maxSteps}) without completing.`, "terminal");
  }

  /**
   * Engine v0.5 — fail a task with an honest dead-letter classification and
   * emit the alert. Centralizes markFailed + alert so every failure path
   * (job-level, in-loop model error, budget, max steps) leaves the same trail.
   */
  private async markTaskFailed(taskId: string, error: string, classification: FailureClassification): Promise<void> {
    await this.taskService.markFailed(taskId, error, classification);
    this.alerts.recordTaskFailed(taskId, classification, error);
  }

  /**
   * Classify a model-call failure (Engine v0.5 dead-letter). A non-transient
   * ModelCallError (4xx / unknown model) and any other unknown error are
   * TERMINAL — they fail immediately. A transient one that exhausted its
   * bounded retries is `transient_exhausted`.
   */
  private classifyModelError(err: unknown): FailureClassification {
    if (err instanceof ModelCallError && err.transient) return "transient_exhausted";
    return "terminal";
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
