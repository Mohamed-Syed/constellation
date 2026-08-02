import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { PluginRegistryService } from "../plugins/plugin-registry.service.js";
import { PluginToolService } from "../plugins/plugin-tool.service.js";
import type { ChatMessage } from "./model-router.service.js";
import { ModelRouterService } from "./model-router.service.js";
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
 * Single-node Redis connection shape. bullmq 6.x's own `ConnectionOptions`
 * is a union that also covers Cluster/Sentinel configs (no `.host`/`.port`
 * on those variants), so we keep our own narrow type here and hand it to
 * bullmq as `ConnectionOptions` at the call site — we only ever build the
 * single-node shape.
 */
interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db: number;
}

function parseRedisUrl(url: string): RedisConnectionOptions {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || "localhost",
      port: Number(u.port) || 6379,
      password: u.password || undefined,
      db: u.pathname ? Number(u.pathname.slice(1)) || 0 : 0,
    };
  } catch {
    return { host: "localhost", port: 6379, db: 0 };
  }
}

/** The fixed permission set granted to the engine agent for tool invocations. */
const AGENT_PERMISSIONS = ["platform:admin"] as const;

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
  private worker!: Worker;
  private readonly connection: RedisConnectionOptions;

  constructor(
    private readonly taskService: TaskService,
    private readonly modelRouter: ModelRouterService,
    private readonly pluginTool: PluginToolService,
    private readonly registry: PluginRegistryService,
    private readonly config: ConfigService,
  ) {
    this.connection = parseRedisUrl(config.get("REDIS_URL", "redis://localhost:6379"));
  }

  onModuleInit() {
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
    const checkpoint = await this.taskService.loadCheckpoint(taskId);
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
        await this.taskService.addStep(taskId, {
          stepIndex,
          type: "tool_call",
          content: { plugin: action.plugin, tool: action.tool, args: action.args ?? {} },
        });

        stepIndex++;
        await this.taskService.saveCheckpoint(taskId, messages, stepIndex);

        const invocation = await this.pluginTool.invoke(
          action.plugin,
          action.tool,
          action.args ?? {},
          AGENT_PERMISSIONS,
        );

        const toolResult =
          invocation.outcome === "completed"
            ? invocation.result
            : { ok: false, error: invocation.message };

        await this.taskService.addStep(taskId, {
          stepIndex,
          type: "tool_result",
          content: toolResult,
        });

        messages.push({
          role: "user",
          content: `Tool result: ${JSON.stringify(toolResult)}`,
        });

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
