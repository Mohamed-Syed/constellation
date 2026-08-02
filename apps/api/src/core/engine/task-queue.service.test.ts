import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { ENGINE_QUEUE_NAME, TaskQueueService } from "./task-queue.service.js";

/**
 * TaskQueueService tests. The BullMQ `Queue` module is mocked wholesale with
 * `vi.mock`, so `onModuleInit()` constructs a fake queue and every subsequent
 * call lands on the same hoisted mock instance — nothing touches Redis.
 *
 * Contracts under test:
 *  1. `onModuleInit` creates the queue with the engine queue name and the
 *     parsed Redis connection options (defaults, full URL, garbage URL).
 *  2. `enqueue` adds a `run` job with { taskId } plus the retry/backoff/
 *     retention options; priority is pass-through.
 *  3. `getHealth` aggregates the three BullMQ counters.
 *  4. `onModuleDestroy` closes the queue — and tolerates never being
 *     initialised (NestJS teardown ordering is not guaranteed).
 */

const queueMock = vi.hoisted(() => ({
  add: vi.fn(async () => undefined),
  getWaitingCount: vi.fn(async () => 0),
  getActiveCount: vi.fn(async () => 0),
  getFailedCount: vi.fn(async () => 0),
  close: vi.fn(async () => undefined),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(() => queueMock),
}));

function makeConfig(overrides: Record<string, string> = {}) {
  return {
    get: vi.fn((key: string, fallback?: unknown) => {
      if (key in overrides) return overrides[key];
      return fallback;
    }),
  } as unknown as ConfigService;
}

function makeService(config: ConfigService = makeConfig()): TaskQueueService {
  return new TaskQueueService(config);
}

beforeEach(() => {
  vi.clearAllMocks();
  queueMock.getWaitingCount.mockResolvedValue(0);
  queueMock.getActiveCount.mockResolvedValue(0);
  queueMock.getFailedCount.mockResolvedValue(0);
});

describe("TaskQueueService — lifecycle", () => {
  it("onModuleInit creates a Queue with the engine queue name and default Redis connection", () => {
    const svc = makeService();
    svc.onModuleInit();

    expect(Queue).toHaveBeenCalledOnce();
    expect(Queue).toHaveBeenCalledWith(ENGINE_QUEUE_NAME, {
      connection: { host: "localhost", port: 6379, password: undefined, db: 0 },
    });
  });

  it("onModuleInit parses a full Redis URL into connection options", () => {
    const svc = makeService(makeConfig({ REDIS_URL: "redis://:s3cret@redis.internal:6380/2" }));
    svc.onModuleInit();

    expect(Queue).toHaveBeenCalledWith(ENGINE_QUEUE_NAME, {
      connection: { host: "redis.internal", port: 6380, password: "s3cret", db: 2 },
    });
  });

  it("onModuleInit falls back to localhost defaults for an unparseable URL", () => {
    const svc = makeService(makeConfig({ REDIS_URL: "not a url at all" }));
    svc.onModuleInit();

    expect(Queue).toHaveBeenCalledWith(ENGINE_QUEUE_NAME, {
      connection: { host: "localhost", port: 6379, db: 0 },
    });
  });

  it("onModuleDestroy closes the queue", async () => {
    const svc = makeService();
    svc.onModuleInit();

    await svc.onModuleDestroy();

    expect(queueMock.close).toHaveBeenCalledOnce();
  });

  it("onModuleDestroy tolerates never having been initialised", async () => {
    const svc = makeService();
    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
    expect(queueMock.close).not.toHaveBeenCalled();
  });
});

describe("TaskQueueService — enqueue", () => {
  it("adds a run job with the taskId and the retry/backoff/retention options", async () => {
    const svc = makeService();
    svc.onModuleInit();

    await svc.enqueue("task-1");

    expect(queueMock.add).toHaveBeenCalledOnce();
    expect(queueMock.add).toHaveBeenCalledWith(
      "run",
      { taskId: "task-1" },
      expect.objectContaining({
        priority: 0,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      }),
    );
  });

  it("passes a custom priority through to the job", async () => {
    const svc = makeService();
    svc.onModuleInit();

    await svc.enqueue("task-2", 10);

    const options = queueMock.add.mock.calls[0]![2] as { priority: number };
    expect(options.priority).toBe(10);
  });

  it("enqueues without an initialised queue only after init", async () => {
    // Guard against regression: enqueue must reach the queue instance
    // created by onModuleInit, not a stale/absent one.
    const svc = makeService();
    await expect(svc.enqueue("task-3")).rejects.toThrow(); // no queue yet
  });
});

describe("TaskQueueService — getHealth", () => {
  it("returns the engine queue name and the three BullMQ counters", async () => {
    const svc = makeService();
    svc.onModuleInit();
    queueMock.getWaitingCount.mockResolvedValue(3);
    queueMock.getActiveCount.mockResolvedValue(2);
    queueMock.getFailedCount.mockResolvedValue(1);

    await expect(svc.getHealth()).resolves.toEqual({
      queue: ENGINE_QUEUE_NAME,
      waiting: 3,
      active: 2,
      failed: 1,
    });
  });
});
