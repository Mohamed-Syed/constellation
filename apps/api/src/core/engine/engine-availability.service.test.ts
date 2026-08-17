import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { EngineAvailabilityService, EngineUnavailableError } from "./engine-availability.service.js";

/**
 * EngineAvailabilityService tests. `ioredis` is mocked wholesale: the fake
 * client records its options, ignores the noop error listener, and consults
 * a shared `state` (set BEFORE the probe runs) to decide whether
 * `connect()`/`ping()` resolve or reject — nothing touches a real socket.
 */

const redisMock = vi.hoisted(() => {
  const state = { connectError: null as Error | null, pingError: null as Error | null };
  return {
    state,
    instances: [] as Array<{
      url: string;
      options: Record<string, unknown>;
      on: ReturnType<typeof vi.fn>;
      connect: ReturnType<typeof vi.fn>;
      ping: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }>,
    __reset: () => {
      state.connectError = null;
      state.pingError = null;
      redisMock.instances = [];
    },
  };
});

vi.mock("ioredis", () => ({
  default: vi.fn((url: string, options: Record<string, unknown>) => {
    const instance = {
      url,
      options,
      on: vi.fn(),
      connect: vi.fn(async () => {
        if (redisMock.state.connectError) throw redisMock.state.connectError;
      }),
      ping: vi.fn(async () => {
        if (redisMock.state.pingError) throw redisMock.state.pingError;
        return "PONG";
      }),
      disconnect: vi.fn(),
    };
    redisMock.instances.push(instance);
    return instance;
  }),
}));

function makeConfig(overrides: Record<string, string | undefined> = {}) {
  return {
    get: vi.fn((key: string) => (key in overrides ? overrides[key] : undefined)),
  } as unknown as ConfigService;
}

function makeService(config: ConfigService = makeConfig()): EngineAvailabilityService {
  return new EngineAvailabilityService(config);
}

beforeEach(() => {
  redisMock.__reset();
  vi.clearAllMocks();
});

describe("EngineAvailabilityService — REDIS_URL unset", () => {
  it("disables with an honest reason and never touches ioredis", async () => {
    const svc = makeService(makeConfig({ REDIS_URL: undefined }));
    await svc.onModuleInit();

    expect(svc.isEnabled).toBe(false);
    expect(svc.reason).toContain("REDIS_URL is not set");
    expect(redisMock.instances).toHaveLength(0);
  });
});

describe("EngineAvailabilityService — Redis reachable", () => {
  it("enables when the probe connects and pings", async () => {
    const svc = makeService(makeConfig({ REDIS_URL: "redis://localhost:6380" }));
    await svc.onModuleInit();

    expect(svc.isEnabled).toBe(true);
    expect(svc.reason).toBeNull();
    expect(redisMock.instances).toHaveLength(1);
    const client = redisMock.instances[0]!;
    // fail-fast probe options were passed through
    expect(client.options.lazyConnect).toBe(true);
    expect(client.options.retryStrategy()).toBeNull();
    // the noop error listener is attached so a failure can't go uncaught
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
    // the client is closed after the probe
    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});

describe("EngineAvailabilityService — Redis unreachable", () => {
  it("disables with the endpoint and error in the reason when connect fails", async () => {
    redisMock.state.connectError = new Error("connect ECONNREFUSED");
    const svc = makeService(makeConfig({ REDIS_URL: "redis://localhost:6380" }));
    await svc.onModuleInit();

    expect(svc.isEnabled).toBe(false);
    expect(svc.reason).toContain("Redis unreachable at localhost:6380");
    expect(svc.reason).toContain("ECONNREFUSED");
  });

  it("disables when connect succeeds but ping fails", async () => {
    redisMock.state.pingError = new Error("socket hang up");
    const svc = makeService(makeConfig({ REDIS_URL: "redis://localhost:6379" }));
    await svc.onModuleInit();

    expect(svc.isEnabled).toBe(false);
    expect(svc.reason).toContain("Redis unreachable at localhost:6379");
  });
});

describe("EngineAvailabilityService — ensureProbed", () => {
  it("runs the probe exactly once and shares the verdict", async () => {
    const svc = makeService(makeConfig({ REDIS_URL: "redis://localhost:6379" }));

    // Concurrent consumers (queue + worker init) call ensureProbed().
    const [a, b] = [svc.ensureProbed(), svc.ensureProbed()];
    await Promise.all([a, b]);

    expect(svc.isEnabled).toBe(true);
    expect(redisMock.instances).toHaveLength(1); // ONE probe client, not two
  });

  it("keeps the verdict once probed, even across later calls", async () => {
    redisMock.state.connectError = new Error("connect ECONNREFUSED");
    const svc = makeService(makeConfig({ REDIS_URL: "redis://localhost:6379" }));
    await svc.ensureProbed();
    expect(svc.isEnabled).toBe(false);

    // A second ensureProbed() does not re-probe or flip the verdict.
    await svc.ensureProbed();
    expect(redisMock.instances).toHaveLength(1);
    expect(svc.isEnabled).toBe(false);
  });
});

describe("EngineUnavailableError", () => {
  it("carries a clear message", () => {
    const err = new EngineUnavailableError("Redis unreachable at localhost:6379");
    expect(err.message).toBe("Engine unavailable: Redis unreachable at localhost:6379");
    expect(err.name).toBe("EngineUnavailableError");
    expect(err).toBeInstanceOf(Error);
  });
});
