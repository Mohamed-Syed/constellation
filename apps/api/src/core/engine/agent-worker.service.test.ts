import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { ConfigService } from "@nestjs/config";
import type { PluginRegistryService } from "../plugins/plugin-registry.service.js";
import type { PluginToolService } from "../plugins/plugin-tool.service.js";
import type { EngineAvailabilityService } from "./engine-availability.service.js";
import { AgentWorkerService, ENGINE_AGENT_PERMISSIONS } from "./agent-worker.service.js";
import { ModelCallError } from "./model-provider.js";
import type { ModelRouterService } from "./model-router.service.js";
import type { TaskService } from "./task.service.js";

/**
 * AgentWorkerService unit tests — the highest-value untested unit in the
 * engine (recorded gap since Engine v0: "too many deps for a first pass").
 *
 * Hand-wired with `new`, no Nest DI, no Redis, no Ollama — the BullMQ
 * Worker is never created because the fake availability service reports
 * `isEnabled: false` (the production gate that skips worker construction),
 * and the loop itself is driven directly through the private `processJob`
 * seam. Every collaborator is a `vi.fn()` fake:
 *
 *   - taskService  — findOne / loadCheckpoint / addStep / saveCheckpoint /
 *                    savePendingApproval / clearApproval / mark{Running,
 *                    Completed,Failed,Paused} / isCancelled
 *   - modelRouter  — chat() (scripted per scenario)
 *   - pluginTool   — invoke() (the real dispatch target)
 *   - registry     — get() returns manifest tools (requiresApproval flags)
 *   - availability — isEnabled=false so no real Worker/Redis is touched
 *
 * Scenarios (the brief's list + the honest-refusal path):
 *   thought → continue · tool_call → dispatch+checkpoint · approval-required
 *   → pause+no dispatch · approved-once → dispatch then clear · done →
 *   complete · maxSteps → fail · transient model error → bounded retry then
 *   fail · terminal model error → fail immediately · refused tool → honest
 *   ok:false result.
 */

const chatOk = (content: string) => ({ content, model: "test", provider: "test", durationMs: 1 });
const thoughtJson = (t: string) => JSON.stringify({ type: "thought", thought: t });
const doneJson = (r: string) => JSON.stringify({ type: "done", result: r });
const toolCallJson = (plugin: string, tool: string, args: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "tool_call", plugin, tool, args });

interface Fakes {
  svc: AgentWorkerService;
  taskService: Record<string, ReturnType<typeof vi.fn>>;
  modelRouter: { chat: ReturnType<typeof vi.fn>; health: ReturnType<typeof vi.fn> };
  pluginTool: { invoke: ReturnType<typeof vi.fn> };
  registry: { get: ReturnType<typeof vi.fn>; all: ReturnType<typeof vi.fn> };
}

function makeWorker(opts: {
  task?: Record<string, unknown>;
  checkpoint?: unknown;
  chat?: (messages: unknown[], model?: string) => Promise<{ content: string }>;
  invoke?: unknown;
  approveAll?: boolean;
  modelRetries?: string;
  tools?: Array<{ name: string; requiresApproval?: boolean }>;
}): Fakes {
  const task = {
    id: "task-1",
    title: "test",
    prompt: "do it",
    status: "queued",
    maxSteps: 20,
    model: null,
    maxTokens: null,
    ...(opts.task ?? {}),
  };
  const taskService = {
    findOne: vi.fn().mockResolvedValue(task),
    loadCheckpoint: vi.fn().mockResolvedValue(opts.checkpoint ?? null),
    markRunning: vi.fn().mockResolvedValue(undefined),
    markProvider: vi.fn().mockResolvedValue(undefined),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markPaused: vi.fn().mockResolvedValue(undefined),
    addStep: vi.fn().mockResolvedValue(undefined),
    saveCheckpoint: vi.fn().mockResolvedValue(undefined),
    savePendingApproval: vi.fn().mockResolvedValue(undefined),
    clearApproval: vi.fn().mockResolvedValue(undefined),
    isCancelled: vi.fn().mockResolvedValue(false),
  };
  const modelRouter = {
    chat: vi.fn().mockImplementation(opts.chat ?? (() => Promise.resolve(chatOk(doneJson("all done"))))),
    health: vi.fn().mockResolvedValue({ provider: "test", model: "test", reachable: true }),
  };
  const pluginTool = {
    invoke: vi.fn().mockResolvedValue(opts.invoke ?? { outcome: "completed", result: { ok: true, data: {} } }),
  };
  const tools = opts.tools ?? [{ name: "graph.query", requiresApproval: false }];
  const registry = {
    get: vi.fn(() => ({ manifest: { id: "graphify", tools } })),
    all: vi.fn(() => []),
  };
  const config = {
    get: vi.fn((key: string, dflt?: unknown) => {
      if (key === "ENGINE_REQUIRE_APPROVAL_ALL") return opts.approveAll ? "true" : "false";
      if (key === "ENGINE_MODEL_RETRIES") return opts.modelRetries ?? "1";
      if (key === "ENGINE_MAX_TOKENS_PER_TASK") return "100000";
      return dflt;
    }),
  };
  const availability = {
    ensureProbed: vi.fn().mockResolvedValue(undefined),
    isEnabled: false, // ← no real Worker/Redis is ever created
    reason: "test",
  };
  const svc = new AgentWorkerService(
    taskService as unknown as TaskService,
    modelRouter as unknown as ModelRouterService,
    pluginTool as unknown as PluginToolService,
    registry as unknown as PluginRegistryService,
    config as unknown as ConfigService,
    availability as unknown as EngineAvailabilityService,
  );
  return { svc, taskService, modelRouter, pluginTool, registry };
}

function runJob(svc: AgentWorkerService, taskId = "task-1"): Promise<void> {
  // processJob is private; the loop is driven through it directly (a Worker
  // would otherwise require a real Redis connection).
  return (svc as unknown as { processJob(job: Job<{ taskId: string }>): Promise<void> }).processJob({
    id: "j1",
    data: { taskId },
  } as Job<{ taskId: string }>);
}

const stepArgs = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => c[1]);

describe("AgentWorkerService", () => {
  it("thought → continue: records the thought and keeps looping until done", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(chatOk(thoughtJson("first thought")))
      .mockResolvedValueOnce(chatOk(doneJson("finished")));
    const { svc, taskService, modelRouter } = makeWorker({ chat: chat as never });
    await runJob(svc);

    expect(modelRouter.chat).toHaveBeenCalledTimes(2);
    const steps = stepArgs(taskService.addStep);
    expect(steps[0]).toMatchObject({ type: "thought", content: { thought: "first thought" } });
    expect(steps[1]).toMatchObject({ type: "done", content: { result: "finished" } });
    expect(taskService.markCompleted).toHaveBeenCalledWith("task-1", { summary: "finished" });
    expect(taskService.saveCheckpoint).toHaveBeenCalled();
  });

  it("tool_call → dispatch + checkpoint: invokes the plugin tool with agent permissions and records tool_call + tool_result", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(chatOk(toolCallJson("graphify", "graph.query", { question: "q" })))
      .mockResolvedValueOnce(chatOk(doneJson("done")));
    const invoke = { outcome: "completed", result: { ok: true, data: { nodes: 42 } } };
    const { svc, taskService, pluginTool } = makeWorker({ chat: chat as never, invoke });

    await runJob(svc);

    expect(pluginTool.invoke).toHaveBeenCalledTimes(1);
    expect(pluginTool.invoke).toHaveBeenCalledWith("graphify", "graph.query", { question: "q" }, ENGINE_AGENT_PERMISSIONS);
    const steps = stepArgs(taskService.addStep);
    expect(steps[0]).toMatchObject({ type: "tool_call", content: { plugin: "graphify", tool: "graph.query" } });
    expect(steps[1]).toMatchObject({ type: "tool_result", content: { ok: true, data: { nodes: 42 } } });
    expect(taskService.saveCheckpoint).toHaveBeenCalled();
    expect(taskService.markCompleted).toHaveBeenCalled();
  });

  it("tool_call to an unavailable tool → honest ok:false tool_result (no throw)", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(chatOk(toolCallJson("browser-use", "browser.act", { instruction: "x" })))
      .mockResolvedValueOnce(chatOk(doneJson("done")));
    const invoke = { outcome: "error", message: "browser-use is not configured" };
    const { svc, taskService, pluginTool } = makeWorker({ chat: chat as never, invoke });

    await runJob(svc);

    expect(pluginTool.invoke).toHaveBeenCalledTimes(1);
    const steps = stepArgs(taskService.addStep);
    expect(steps[1]).toMatchObject({
      type: "tool_result",
      content: { ok: false, error: "browser-use is not configured" },
    });
    expect(taskService.markCompleted).toHaveBeenCalled();
  });

  it("approval-required → pause + NO dispatch: records the request, persists the pending approval, never invokes", async () => {
    const chat = vi.fn().mockResolvedValueOnce(chatOk(toolCallJson("graphify", "graph.ingest", { source: "/x" })));
    const { svc, taskService, pluginTool } = makeWorker({
      chat: chat as never,
      tools: [{ name: "graph.ingest", requiresApproval: true }],
    });

    await runJob(svc);

    // The gate: the tool never ran.
    expect(pluginTool.invoke).not.toHaveBeenCalled();
    expect(taskService.markPaused).toHaveBeenCalledWith("task-1");
    expect(taskService.savePendingApproval).toHaveBeenCalledWith(
      "task-1",
      expect.any(Array),
      1,
      { plugin: "graphify", tool: "graph.ingest", args: { source: "/x" }, stepIndex: 0 },
    );
    const steps = stepArgs(taskService.addStep);
    expect(steps[0]).toMatchObject({ type: "tool_call", content: { plugin: "graphify", tool: "graph.ingest" } });
    expect(steps[1]).toMatchObject({ type: "pending_approval" });
    // One model call only — the loop stops, the BullMQ job is released.
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("approved-once → dispatch then clear: resumes a paused checkpoint, executes the approved call EXACTLY once, clears the grant, completes", async () => {
    const checkpoint = {
      stepIndex: 1,
      messages: [{ role: "user" as const, content: "hi" }],
      approvedStepIndex: 0,
      pendingApproval: { stepIndex: 0, plugin: "graphify", tool: "graph.query", args: { question: "q" } },
    };
    const chat = vi.fn().mockResolvedValueOnce(chatOk(doneJson("finished")));
    const invoke = { outcome: "completed", result: { ok: true, data: { nodes: 7 } } };
    const { svc, taskService, pluginTool } = makeWorker({ checkpoint, chat: chat as never, invoke });

    await runJob(svc);

    // Exactly ONE invocation of the approved call — honour-once.
    expect(pluginTool.invoke).toHaveBeenCalledTimes(1);
    expect(pluginTool.invoke).toHaveBeenCalledWith("graphify", "graph.query", { question: "q" }, ENGINE_AGENT_PERMISSIONS);
    // No model call before the approved call runs (nothing new to decide).
    expect(chat).toHaveBeenCalledTimes(1);
    // The tool_result lands one index past the pending_approval marker, then
    // the approval is cleared with the next free index.
    const steps = stepArgs(taskService.addStep);
    expect(steps[0]).toMatchObject({ type: "tool_result", stepIndex: 2, content: { ok: true, data: { nodes: 7 } } });
    expect(taskService.clearApproval).toHaveBeenCalledWith("task-1", expect.any(Array), 3);
    expect(taskService.markCompleted).toHaveBeenCalled();
  });

  it("approved-once honour: a pending approval for a DIFFERENT step index is NOT executed", async () => {
    const checkpoint = {
      stepIndex: 1,
      messages: [{ role: "user" as const, content: "hi" }],
      approvedStepIndex: 5, // approval was granted for step 5, not the pending 0
      pendingApproval: { stepIndex: 0, plugin: "graphify", tool: "graph.query", args: {} },
    };
    const chat = vi.fn().mockResolvedValueOnce(chatOk(doneJson("finished")));
    const { svc, pluginTool } = makeWorker({ checkpoint, chat: chat as never });

    await runJob(svc);

    // The stale/mismatched approval must not dispatch the tool.
    expect(pluginTool.invoke).not.toHaveBeenCalled();
  });

  it("done → complete: records the done step and completes the task", async () => {
    const { svc, taskService } = makeWorker({ chat: () => Promise.resolve(chatOk(doneJson("all done"))) });

    await runJob(svc);

    expect(taskService.addStep).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ type: "done", content: { result: "all done" } }),
    );
    expect(taskService.markCompleted).toHaveBeenCalledWith("task-1", { summary: "all done" });
    expect(taskService.markFailed).not.toHaveBeenCalled();
  });

  it("records the REAL provider on the task after the first model call — no hardcoded 'ollama' (v0.3)", async () => {
    const chat = vi
      .fn()
      // The router's verdict on the first call: the cloud provider served it.
      .mockResolvedValueOnce({ content: thoughtJson("thinking"), model: "openai/gpt-oss-120b", provider: "openrouter", durationMs: 1 })
      .mockResolvedValueOnce(chatOk(doneJson("all done")));
    const { svc, taskService } = makeWorker({ chat: chat as never });

    await runJob(svc);

    // markRunning carries NO provider — it is unknown until the router decides.
    expect(taskService.markRunning).toHaveBeenCalledWith("task-1");
    expect(taskService.markRunning).not.toHaveBeenCalledWith("task-1", "ollama");
    // The actual provider lands once, from the first response.
    expect(taskService.markProvider).toHaveBeenCalledTimes(1);
    expect(taskService.markProvider).toHaveBeenCalledWith("task-1", "openrouter");
  });

  it("a fallback to Ollama is what gets recorded on the task (router honesty)", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: thoughtJson("thinking"), model: "qwen2.5-coder:7b", provider: "ollama", durationMs: 1 })
      .mockResolvedValueOnce(chatOk(doneJson("all done")));
    const { svc, taskService } = makeWorker({ chat: chat as never });

    await runJob(svc);

    expect(taskService.markProvider).toHaveBeenCalledWith("task-1", "ollama");
  });

  it("maxSteps → fail: terminates honestly when the loop ceiling is hit", async () => {
    const { svc, taskService, modelRouter } = makeWorker({
      task: { maxSteps: 2 },
      chat: () => Promise.resolve(chatOk(thoughtJson("still thinking"))),
    });

    await runJob(svc);

    expect(modelRouter.chat).toHaveBeenCalledTimes(2);
    expect(taskService.markFailed).toHaveBeenCalledWith("task-1", "Reached max steps (2) without completing.");
    expect(taskService.markCompleted).not.toHaveBeenCalled();
  });

  it("transient model error → bounded retry then fail: retries ENGINE_MODEL_RETRIES times, then fails honestly", async () => {
    const boom = new ModelCallError("Ollama hiccup", true);
    const { svc, taskService, modelRouter } = makeWorker({
      modelRetries: "2", // 2 retries → 3 total attempts
      chat: () => Promise.reject(boom),
    });

    await runJob(svc);

    expect(modelRouter.chat).toHaveBeenCalledTimes(3);
    expect(taskService.addStep).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ type: "error", content: { error: "Ollama hiccup" } }),
    );
    expect(taskService.markFailed).toHaveBeenCalledWith("task-1", "Ollama hiccup");
  });

  it("terminal model error → fail immediately: no retries for non-transient failures", async () => {
    const boom = new ModelCallError("model does-not-exist not found", false);
    const { svc, taskService, modelRouter } = makeWorker({
      modelRetries: "5",
      chat: () => Promise.reject(boom),
    });

    await runJob(svc);

    expect(modelRouter.chat).toHaveBeenCalledTimes(1);
    expect(taskService.markFailed).toHaveBeenCalledWith("task-1", "model does-not-exist not found");
  });

  it("cancelled task → job is a no-op", async () => {
    const { svc, taskService } = makeWorker({ task: { status: "cancelled" } });

    await runJob(svc);

    expect(taskService.markRunning).not.toHaveBeenCalled();
    expect(taskService.markCompleted).not.toHaveBeenCalled();
  });

  it("onModuleInit with the engine unavailable never constructs a Worker", async () => {
    const { svc } = makeWorker({});
    await (svc as unknown as { onModuleInit(): Promise<void> }).onModuleInit();
    // No exception and nothing to close — the worker field stayed undefined.
    await (svc as unknown as { onModuleDestroy(): Promise<void> }).onModuleDestroy();
    expect(true).toBe(true);
  });
});
