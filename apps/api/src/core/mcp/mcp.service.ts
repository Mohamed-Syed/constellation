import { Injectable, Logger, Optional } from "@nestjs/common";
import { TaskQueueService } from "../engine/task-queue.service.js";
import { TaskService } from "../engine/task.service.js";
import { ScheduledTaskService } from "../engine/scheduled-task.service.js";
import { EngineAvailabilityService } from "../engine/engine-availability.service.js";
import { ModelRouterService } from "../engine/model-router.service.js";
import { SupervisorService } from "../engine/supervisor.service.js";
import { EngineAlertService } from "../engine/engine-alerts.service.js";

/**
 * Phase 4.0 — MCP SERVER (Model Context Protocol over HTTP, zero-dep).
 *
 * Exposes Constellation's engine as MCP TOOLS so any MCP client (Claude
 * Desktop, Cursor, an agent runtime…) can drive it. Transport: JSON-RPC 2.0
 * POSTed to /api/mcp, guarded by the same JWT as everything else (an MCP
 * client supplies the portal bearer token).
 *
 * Supported methods (the request/response subset of the 2025-03-26 spec):
 *   initialize                → protocolVersion + capabilities + serverInfo
 *   notifications/initialized → {}
 *   ping                      → {}
 *   tools/list                → the tool registry (below)
 *   tools/call                → { content: [{ type: "text", text }], isError? }
 *   resources/list            → [] (no resources yet)
 *
 * Tools:
 *   constellation.list_tasks    {status?, teamId?}     engine tasks (summary)
 *   constellation.run_task      {title, prompt, model?, maxSteps?, maxTokens?, teamId?}
 *                                                        submit + bounded poll →
 *                                                        terminal record with usage
 *   constellation.engine_health {}                      the /api/engine/health payload
 *   constellation.list_schedules {}                     scheduler schedules
 *
 * Every handler resolves to a JSON string; failures become MCP errors (never
 * throws out of `handle`).
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2025-03-26";
const RUN_POLL_ATTEMPTS = 24;
const RUN_POLL_DELAY_MS = 5_000;

const TOOLS: McpTool[] = [
  {
    name: "constellation.list_tasks",
    description: "List engine tasks (newest first, capped at 100). Optional filters: status, teamId.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "queued | running | completed | failed | cancelled | paused" },
        teamId: { type: "string", description: "Team-scoped view (members/admins only)." },
      },
    },
  },
  {
    name: "constellation.run_task",
    description: "Submit an agent task and wait for it to finish; returns the terminal record incl. persisted usage/cost.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        prompt: { type: "string" },
        model: { type: "string", description: "e.g. qwen2.5-coder:7b (default) or deepseek-v4-flash" },
        maxSteps: { type: "number", minimum: 1, maximum: 50 },
        maxTokens: { type: "number", minimum: 1 },
        teamId: { type: "string" },
      },
      required: ["title", "prompt"],
    },
  },
  {
    name: "constellation.engine_health",
    description: "Engine health: availability, queue depth, model providers, scheduler, supervisor, alert trail.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "constellation.list_schedules",
    description: "List scheduler schedules (cron/event) with run counts and last error.",
    inputSchema: { type: "object", properties: {} },
  },
];

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly tasks: TaskService,
    private readonly queue: TaskQueueService,
    private readonly availability: EngineAvailabilityService,
    private readonly modelRouter: ModelRouterService,
    private readonly schedules: ScheduledTaskService,
    @Optional() private readonly scheduler?: SchedulerEngineServiceLike,
    @Optional() private readonly supervisor?: SupervisorService,
    @Optional() private readonly alerts?: EngineAlertService,
    @Optional() private readonly pollDelayMs?: number,
  ) {}

  /** Entry point: one JSON-RPC request → one JSON-RPC response. Never throws. */
  async handle(raw: unknown): Promise<unknown> {
    const id = extractId(raw);
    const method = typeof (raw as { method?: unknown })?.method === "string" ? (raw as { method: string }).method : "";
    if (!method) {
      return jsonRpcError(id, -32600, "Invalid Request: a JSON-RPC method is required.");
    }
    const params = (raw as { params?: unknown })?.params;
    try {
      switch (method) {
        case "initialize":
          return jsonRpcResult(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "constellation-mcp", version: "0.1.0" },
          });
        case "notifications/initialized":
        case "ping":
          return jsonRpcResult(id, {});
        case "tools/list":
          return jsonRpcResult(id, { tools: TOOLS });
        case "resources/list":
          return jsonRpcResult(id, { resources: [] });
        case "tools/call":
          return await this.callTool(id, params);
        default:
          return jsonRpcError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      this.logger.warn(`MCP ${method} failed: ${asMessage(err)}`);
      return jsonRpcError(id, -32603, `Internal error: ${asMessage(err)}`);
    }
  }

  private async callTool(id: unknown, params: unknown): Promise<unknown> {
    const name = typeof (params as { name?: unknown })?.name === "string" ? (params as { name: string }).name : "";
    const args = (params as { arguments?: Record<string, unknown> })?.arguments ?? {};
    if (!name) return jsonRpcError(id, -32602, "tools/call requires a tool name.");
    try {
      const output = await this.dispatch(name, args);
      return jsonRpcResult(id, { content: [{ type: "text", text: JSON.stringify(output) }], isError: false });
    } catch (err) {
      // Tool-level failure = a normal MCP response with isError: true.
      return jsonRpcResult(id, {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: asMessage(err) }) }],
        isError: true,
      });
    }
  }

  private async dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "constellation.list_tasks": {
        const status = typeof args.status === "string" ? args.status : undefined;
        const teamId = typeof args.teamId === "string" ? args.teamId : undefined;
        const rows = await this.tasks.findAll({ teamId });
        const filtered = status ? rows.filter((r) => r.status === status) : rows;
        return {
          ok: true,
          count: filtered.length,
          tasks: filtered.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            model: r.model,
            provider: r.provider,
            teamId: r.teamId ?? null,
            totalTokens: r.totalTokens ?? null,
            costUSD: r.costUSD ?? null,
            createdAt: r.createdAt,
          })),
        };
      }
      case "constellation.run_task": {
        const title = typeof args.title === "string" ? args.title : "";
        const prompt = typeof args.prompt === "string" ? args.prompt : "";
        if (!title.trim() || !prompt.trim()) throw new Error("run_task requires title and prompt.");
        const task = await this.tasks.create(
          {
            title,
            prompt,
            model: typeof args.model === "string" ? args.model : undefined,
            maxSteps: typeof args.maxSteps === "number" ? args.maxSteps : undefined,
            maxTokens: typeof args.maxTokens === "number" ? args.maxTokens : undefined,
            teamId: typeof args.teamId === "string" ? args.teamId : undefined,
          },
          undefined,
        );
        await this.queue.enqueue(task.id);
        const terminal = await this.waitForTerminal(task.id);
        return {
          ok: true,
          id: terminal.id,
          status: terminal.status,
          provider: terminal.provider,
          error: terminal.error,
          result: terminal.result ?? null,
          stepCount: terminal.stepCount,
          totalTokens: terminal.totalTokens ?? null,
          costUSD: terminal.costUSD ?? null,
        };
      }
      case "constellation.engine_health": {
        const model = await this.modelRouter.health();
        const queue = await this.queue.getHealth();
        const scheduler = this.scheduler ? await this.scheduler.getHealth() : { enabled: false };
        const supervision = this.supervisor ? await this.supervisor.getHealth() : { enabled: false };
        const failedTasks = await this.tasks.getFailedCount();
        const alerts = this.alerts ? await this.alerts.getAlertSummary() : [];
        return {
          ok: true,
          engine: this.availability.isEnabled ? "available" : "unavailable",
          reason: this.availability.reason,
          queue: { ...queue, failedTasks },
          model,
          scheduler,
          supervision,
          alerts,
          timestamp: new Date().toISOString(),
        };
      }
      case "constellation.list_schedules": {
        const rows = await this.schedules.findAll();
        return {
          ok: true,
          count: rows.length,
          schedules: rows.map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.kind,
            enabled: s.enabled,
            runCount: s.runCount,
            lastError: s.lastError,
            nextRunAt: s.nextRunAt,
            workflowId: s.workflowId ?? null,
          })),
        };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /** Bounded poll for a terminal task record (injectable clock keeps tests fast). */
  private async waitForTerminal(taskId: string): Promise<Awaited<ReturnType<TaskService["findOne"]>> & { stepCount: number }> {
    for (let i = 0; i < RUN_POLL_ATTEMPTS; i++) {
      const row = await this.tasks.findOne(taskId);
      if (!row) throw new Error(`Task ${taskId} disappeared while polling.`);
      const status = String(row.status);
      if (status === "completed" || status === "failed" || status === "cancelled") {
        return { ...row, stepCount: row.stepCount ?? (Array.isArray(row.steps) ? row.steps.length : 0) };
      }
      await sleep(this.pollDelayMs ?? RUN_POLL_DELAY_MS);
    }
    throw new Error(`Task ${taskId} did not reach a terminal state within ${(RUN_POLL_ATTEMPTS * RUN_POLL_DELAY_MS) / 1000}s.`);
  }
}

/** Structural stand-in so hand-wired tests can pass a fake; Nest injects the real service. */
export interface SchedulerEngineServiceLike {
  getHealth(): Promise<Record<string, unknown>>;
}

function extractId(raw: unknown): unknown {
  const id = (raw as { id?: unknown })?.id;
  return id === undefined ? null : id;
}

function jsonRpcResult(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
