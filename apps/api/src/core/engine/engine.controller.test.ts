import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { EngineUnavailableError } from "./engine-availability.service.js";
import { EngineController } from "./engine.controller.js";

/**
 * EngineController tests — hand-wired with `new`, no Nest DI container
 * (same offline pattern as the rest of the engine suite). Focus is the
 * Engine v0.1 availability contract:
 *  - submitTask → clean 503 when the engine is disabled (never a hang), and
 *    the task is NOT created;
 *  - when the queue dies between the check and the enqueue, the task row is
 *    marked failed and the caller still gets a 503;
 *  - `/health` reports engine available/unavailable with a reason.
 */

function makeTasksStub() {
  return {
    create: vi.fn(async (dto: { title: string }) => ({
      id: "task-1",
      title: dto.title,
      status: "queued",
      createdAt: new Date().toISOString(),
    })),
    findAll: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
    cancel: vi.fn(async () => true),
    markFailed: vi.fn(async () => undefined),
  };
}

function makeQueueStub() {
  return {
    enqueue: vi.fn(async () => undefined),
    getHealth: vi.fn(async () => ({
      enabled: true,
      queue: "engine-tasks",
      waiting: 1,
      active: 0,
      failed: 0,
    })),
  };
}

function makeModelStub() {
  return {
    health: vi.fn(async () => ({ provider: "ollama", model: "qwen2.5-coder:1.5b", reachable: true })),
  };
}

function makeAvailability(enabled: boolean, reason: string | null = null) {
  return { isEnabled: enabled, reason };
}

function makeController(
  availability = makeAvailability(true),
  tasks = makeTasksStub(),
  queue = makeQueueStub(),
  model = makeModelStub(),
) {
  const controller = new EngineController(
    tasks as never,
    queue as never,
    model as never,
    availability as never,
  );
  return { controller, tasks, queue, model, availability };
}

const user: AuthPrincipal = { id: "user-1", email: "a@b.c", roles: ["admin"], permissions: ["platform:admin"] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EngineController — submitTask with a disabled engine", () => {
  it("returns a clean 503 without creating a task row", async () => {
    const { controller, tasks, queue } = makeController(
      makeAvailability(false, "Redis unreachable at localhost:6380"),
    );

    await expect(
      controller.submitTask({ title: "t", prompt: "p" }, user),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(tasks.create).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});

describe("EngineController — submitTask with an enabled engine", () => {
  it("creates the task and enqueues it", async () => {
    const { controller, tasks, queue } = makeController();

    const result = await controller.submitTask({ title: "t", prompt: "p" }, user);

    expect(tasks.create).toHaveBeenCalledOnce();
    expect(queue.enqueue).toHaveBeenCalledWith("task-1");
    expect(result).toMatchObject({ id: "task-1", status: "queued", title: "t" });
  });

  it("marks the task failed and returns 503 if Redis dies between check and enqueue", async () => {
    const queue = makeQueueStub();
    queue.enqueue.mockRejectedValueOnce(new EngineUnavailableError("could not enqueue task task-1: ECONNREFUSED"));
    const { controller, tasks } = makeController(makeAvailability(true), makeTasksStub(), queue);

    await expect(
      controller.submitTask({ title: "t", prompt: "p" }, user),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(tasks.markFailed).toHaveBeenCalledWith("task-1", expect.stringContaining("Engine unavailable"));
  });
});

describe("EngineController — health", () => {
  it("reports the engine available with queue + model when enabled", async () => {
    const { controller, queue, model } = makeController();

    const health = await controller.health();

    expect(health.engine).toBe("available");
    expect(health.reason).toBeNull();
    expect(health.queue).toEqual({ enabled: true, queue: "engine-tasks", waiting: 1, active: 0, failed: 0 });
    expect(health.model.reachable).toBe(true);
    expect(queue.getHealth).toHaveBeenCalledOnce();
    expect(model.health).toHaveBeenCalledOnce();
  });

  it("reports the engine unavailable with a reason when disabled", async () => {
    const queue = makeQueueStub();
    queue.getHealth.mockResolvedValueOnce({ enabled: false, reason: "REDIS_URL is not set" });
    const { controller } = makeController(makeAvailability(false, "REDIS_URL is not set"), makeTasksStub(), queue);

    const health = await controller.health();

    expect(health.engine).toBe("unavailable");
    expect(health.reason).toContain("REDIS_URL is not set");
    expect(health.queue).toEqual({ enabled: false, reason: "REDIS_URL is not set" });
    expect(queue.getHealth).toHaveBeenCalledOnce();
  });
});
