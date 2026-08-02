import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import type { EngineAvailabilityService } from "./engine-availability.service.js";
import { EngineUnavailableError } from "./engine-availability.service.js";
import { ENGINE_QUEUE_NAME, TaskQueueService } from "./task-queue.service.js";

/**
 * TaskQueueService tests. The BullMQ `Queue` module is mocked wholesale with
 * `vi.mock`, so `onModuleInit()` constructs a fake queue and every subsequent
 * call lands on the same hoisted mock instance — nothing touches Redis.
 *
 * Engine v0.1 additions under test:
 *  - availability gating: with the engine disabled, `onModuleInit` does NOT
 *    construct a Queue, `enqueue` throws EngineUnavailableError (→ 503), and
 *    `getHealth` reports `{ enabled:false, reason }`.
 *  - the connection options passed to bullmq are the fail-fast ones.
 *  - the v0 contracts still hold when the engine is enabled (job options,
 *    priority passthrough, health counters, teardown).
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

/** Minimal EngineAvailabilityService stand-in. */
function makeAvailability(
  enabled: boolean,
  reason: string | null = null,
): Pick<EngineAvailabilityService, "isEnabled" | "reason" | "ensureProbed"> {
  return { isEnabled: enabled, reason, ensureProbed: vi.fn(async () => undefined) };
}

function makeService(
  config: ConfigService = makeConfig(),
  availability = makeAvailability(true),
): TaskQueueService {
  return new TaskQueueService(config, availability);
}

beforeEach(() => {
  vi.clearAllMocks();
  queueMock.getWaitingCount.mockResolvedValue(0);
  queueMock.getActiveCount.mockResolvedValue(0);
  queueMock.getFailedCount.mockResolvedValue(0);
});

describe("TaskQueueService — lifecycle (engine enabled)", () => {
  it("onModuleInit creates a Queue with the engine queue name and fail-fast connection", async () => {
    const svc = makeService();
    await svc.onModuleInit();

    expect(Queue).toHaveBeenCalledOnce();
    expect(Queue).toHaveBeenCalledWith(ENGINE_QUEUE_NAME, {
      connection: expect.objectContaining({
        host: "localhost",
        port: 6379,
        password: undefined,
        db: 0,
        connectTimeout: expect.any(Number),
        enableOfflineQueue: false,
        retryStrategy: expect.any(Function),
      }),
    });
  });

  it("onModuleInit parses a full Redis URL into connection options", async () => {
    const svc = makeService(makeConfig({ REDIS_URL: "redis://:s3cret@redis.internal:6380/2" }));
    await svc.onModuleInit();

    expect(Queue).toHaveBeenCalledWith(ENGINE_QUEUE_NAME, {
      connection: expect.objectContaining({
        host: "redis.internal",
        port: 6380,
        password: "s3cret",
        db: 2,
      }),
    });
  });

  it("onModuleInit falls back to localhost defaults for an unparseable URL", async () => {
    const svc = makeService(makeConfig({ REDIS_URL: "not a url at all" }));
    await svc.onModuleInit();

    expect(Queue).toHaveBeenCalledWith(ENGINE_QUEUE_NAME, {
      connection: expect.objectContaining({ host: "localhost", port: 6379, db: 0 }),
    });
  });

  it("onModuleDestroy closes the queue", async () => {
    const svc = makeService();
    await svc.onModuleInit();

    await svc.onModuleDestroy();

    expect(queueMock.close).toHaveBeenCalledOnce();
  });

  it("onModuleDestroy tolerates never having been initialised", async () => {
    const svc = makeService();
    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
    expect(queueMock.close).not.toHaveBeenCalled();
  });
});

describe("TaskQueueService — lifecycle (engine disabled)", () => {
  it("does NOT construct a Queue when the engine is unavailable", async () => {
    const svc = makeService(makeConfig(), makeAvailability(false, "Redis unreachable at localhost:6380"));
    await svc.onModuleInit();

    expect(Queue).not.toHaveBeenCalled();
  });

  it("onModuleDestroy tolerates a disabled engine", async () => {
    const svc = makeService(makeConfig(), makeAvailability(false, "REDIS_URL is not set"));
    await svc.onModuleInit();

    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
    expect(queueMock.close).not.toHaveBeenCalled();
  });
});

describe("TaskQueueService — enqueue", () => {
  it("adds a run job with the taskId and the retry/backoff/retention options", async () => {
    const svc = makeService();
    await svc.onModuleInit();

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
    await svc.onModuleInit();

    await svc.enqueue("task-2", 10);

    const options = queueMock.add.mock.calls[0]![2] as { priority: number };
    expect(options.priority).toBe(10);
  });

  it("enqueues without an initialised queue only after init", async () => {
    const svc = makeService();
    await expect(svc.enqueue("task-3")).rejects.toThrow(); // no queue yet
  });

  it("throws EngineUnavailableError (→ 503) when the engine is disabled", async () => {
    const svc = makeService(makeConfig(), makeAvailability(false, "Redis unreachable at localhost:6380"));
    await svc.onModuleInit();

    await expect(svc.enqueue("task-4")).rejects.toBeInstanceOf(EngineUnavailableError);
    expect(queueMock.add).not.toHaveBeenCalled();
  });
});

describe("TaskQueueService — getHealth", () => {
  it("returns the engine queue name and the three BullMQ counters when enabled", async () => {
    const svc = makeService();
    await svc.onModuleInit();
    queueMock.getWaitingCount.mockResolvedValue(3);
    queueMock.getActiveCount.mockResolvedValue(2);
    queueMock.getFailedCount.mockResolvedValue(1);

    await expect(svc.getHealth()).resolves.toEqual({
      enabled: true,
      queue: ENGINE_QUEUE_NAME,
      waiting: 3,
      active: 2,
      failed: 1,
    });
  });

  it("reports enabled:false with the reason when disabled", async () => {
    const svc = makeService(makeConfig(), makeAvailability(false, "REDIS_URL is not set"));

    await expect(svc.getHealth()).resolves.toEqual({
      enabled: false,
      reason: "REDIS_URL is not set",
    });
  });
});
