import { afterEach, describe, expect, it, vi } from "vitest";
import { engineLoopsRunHere, isDedicatedWorkerProcess } from "./engine-worker-role.js";

/**
 * Engine worker-role gate tests (Phase 2.0 2.8). The role is read from the
 * environment at call time, so `vi.stubEnv` exercises every combination.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("engineLoopsRunHere — where do the engine loops run?", () => {
  it("embedded (default, env unset): the api runs everything", () => {
    expect(engineLoopsRunHere()).toBe(true);
  });

  it("ENGINE_WORKER_MODE=separate without ENGINE_IS_WORKER: the api defers", () => {
    vi.stubEnv("ENGINE_WORKER_MODE", "separate");
    expect(engineLoopsRunHere()).toBe(false);
  });

  it("ENGINE_WORKER_MODE=separate WITH ENGINE_IS_WORKER=true: the worker runs them", () => {
    vi.stubEnv("ENGINE_WORKER_MODE", "separate");
    vi.stubEnv("ENGINE_IS_WORKER", "true");
    expect(engineLoopsRunHere()).toBe(true);
  });

  it("isDedicatedWorkerProcess is true only in the worker entrypoint", () => {
    expect(isDedicatedWorkerProcess()).toBe(false);
    vi.stubEnv("ENGINE_IS_WORKER", "true");
    expect(isDedicatedWorkerProcess()).toBe(true);
  });
});
