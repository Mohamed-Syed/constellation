import { describe, expect, it, vi } from "vitest";
import { McpService } from "./mcp.service.js";
import type { TaskService } from "../engine/task.service.js";
import type { TaskQueueService } from "../engine/task-queue.service.js";
import type { ScheduledTaskService } from "../engine/scheduled-task.service.js";

function makeSvc(overrides: Record<string, unknown> = {}) {
  const tasks = {
    findAll: vi.fn(async () => []),
    create: vi.fn(async (dto: { title: string; prompt: string }) => ({ id: "t1", status: "queued", ...dto })),
    findOne: vi.fn(async () => ({ id: "t1", status: "completed", title: "x", result: { summary: "ok" }, stepCount: 3 })),
    getFailedCount: vi.fn(async () => 0),
    ...(overrides.tasks ?? {}),
  };
  const queue = {
    enqueue: vi.fn(async () => undefined),
    getHealth: vi.fn(async () => ({ waiting: 0, active: 0, failed: 0 })),
    ...(overrides.queue ?? {}),
  };
  const availability = { isEnabled: true, reason: null, ...(overrides.availability ?? {}) };
  const modelRouter = { health: vi.fn(async () => ({ primary: { provider: "ollama", reachable: true }, providers: [] })), ...(overrides.modelRouter ?? {}) };
  const schedules = { findAll: vi.fn(async () => []), ...(overrides.schedules ?? {}) };
  const scheduler = { getHealth: vi.fn(async () => ({ enabled: true, pollIntervalMs: 5000 })), ...(overrides.scheduler ?? {}) };
  const supervisor = { getHealth: vi.fn(async () => ({ enabled: true })), ...(overrides.supervisor ?? {}) };
  const alerts = { getAlertSummary: vi.fn(async () => []), ...(overrides.alerts ?? {}) };
  const svc = new McpService(
    tasks as unknown as TaskService,
    queue as unknown as TaskQueueService,
    availability as never,
    modelRouter as never,
    schedules as unknown as ScheduledTaskService,
    scheduler as never,
    supervisor as never,
    alerts as never,
    undefined, // delegation — not exercised in this harness
    1, // pollDelayMs — tests stay fast
  );
  return { svc, tasks, queue, schedules, modelRouter };
}

describe("McpService — protocol handshake", () => {
  it("initialize returns protocolVersion, capabilities and serverInfo", async () => {
    const { svc } = makeSvc();
    const res = await svc.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(res).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "constellation-mcp" },
      },
    });
  });

  it("ping + notifications/initialized + resources/list are handled", async () => {
    const { svc } = makeSvc();
    await expect(svc.handle({ jsonrpc: "2.0", id: 2, method: "ping" })).resolves.toMatchObject({ id: 2, result: {} });
    await expect(svc.handle({ jsonrpc: "2.0", id: 3, method: "notifications/initialized" })).resolves.toMatchObject({ result: {} });
    await expect(svc.handle({ jsonrpc: "2.0", id: 4, method: "resources/list" })).resolves.toMatchObject({
      result: { resources: [] },
    });
  });

  it("tools/list exposes the five constellation tools", async () => {
    const { svc } = makeSvc();
    const result = (await svc.handle({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })) as {
      result: { tools: { name: string }[] };
    };
    expect(result.result.tools.map((t) => t.name)).toEqual([
      "constellation.list_tasks",
      "constellation.run_task",
      "constellation.engine_health",
      "constellation.list_schedules",
      "constellation.delegate_task",
    ]);
    for (const tool of result.result.tools) {
      expect(tool.inputSchema).toBeTruthy();
    }
  });

  it("rejects missing/unknown methods with JSON-RPC errors", async () => {
    const { svc } = makeSvc();
    await expect(svc.handle({ jsonrpc: "2.0", id: 6 })).resolves.toMatchObject({ error: { code: -32600 } });
    await expect(svc.handle({ jsonrpc: "2.0", id: 7, method: "nope" })).resolves.toMatchObject({ error: { code: -32601 } });
  });
});

describe("McpService — tools/call", () => {
  it("list_tasks maps rows to the MCP summary shape (optional status filter)", async () => {
    const { svc, tasks } = makeSvc();
    tasks.findAll.mockResolvedValue([
      { id: "t1", title: "a", status: "completed", model: "qwen", provider: "ollama", teamId: null, totalTokens: 10, costUSD: 0, createdAt: new Date() },
      { id: "t2", title: "b", status: "failed", model: null, provider: null, teamId: "team-1", totalTokens: null, costUSD: null, createdAt: new Date() },
    ]);
    const res = (await svc.handle({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "constellation.list_tasks", arguments: { status: "failed" } },
    })) as { result: { content: Array<{ text: string }> } };
    const parsed = JSON.parse(res.result.content[0]!.text) as { ok: boolean; count: number; tasks: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.count).toBe(1);
    expect(parsed.tasks[0]).toMatchObject({ id: "t2", teamId: "team-1" });
  });

  it("run_task submits, enqueues and polls to the terminal record with usage", async () => {
    const { svc, tasks, queue } = makeSvc();
    tasks.findOne
      .mockResolvedValueOnce({ id: "t1", status: "queued", title: "x" })
      .mockResolvedValueOnce({ id: "t1", status: "completed", title: "x", result: { summary: "done" }, stepCount: 2, provider: "ollama", totalTokens: 42, costUSD: 0, error: null });
    const res = (await svc.handle({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "constellation.run_task", arguments: { title: "mcp task", prompt: "work", maxSteps: 3 } },
    })) as { result: { content: Array<{ text: string }> } };
    const parsed = JSON.parse(res.result.content[0]!.text) as Record<string, unknown>;
    expect(tasks.create).toHaveBeenCalledWith(expect.objectContaining({ title: "mcp task", prompt: "work", maxSteps: 3, teamId: undefined }), undefined);
    expect(queue.enqueue).toHaveBeenCalledWith("t1");
    expect(parsed).toMatchObject({ ok: true, id: "t1", status: "completed", totalTokens: 42, costUSD: 0 });
  });

  it("run_task surfaces validation failures as isError tool results", async () => {
    const { svc } = makeSvc();
    const res = (await svc.handle({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "constellation.run_task", arguments: { title: "", prompt: "" } },
    })) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(res.result.isError).toBe(true);
    expect(JSON.parse(res.result.content[0]!.text)).toMatchObject({ ok: false, error: expect.stringContaining("title and prompt") });
  });

  it("engine_health mirrors the engine health payload", async () => {
    const { svc } = makeSvc();
    const res = (await svc.handle({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "constellation.engine_health", arguments: {} } })) as {
      result: { content: Array<{ text: string }> };
    };
    const parsed = JSON.parse(res.result.content[0]!.text) as Record<string, unknown>;
    expect(parsed).toMatchObject({ ok: true, engine: "available", queue: expect.any(Object), model: expect.any(Object) });
  });

  it("unknown tools and malformed calls produce honest errors", async () => {
    const { svc } = makeSvc();
    const res = (await svc.handle({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "constellation.nope", arguments: {} },
    })) as { result: { isError: boolean } };
    expect(res.result.isError).toBe(true);
    await expect(svc.handle({ jsonrpc: "2.0", id: 13, method: "tools/call", params: {} })).resolves.toMatchObject({
      error: { code: -32602 },
    });
  });
});
