/**
 * Engine worker-role gate (Phase 2.0 2.8 — worker as a separate process).
 *
 * The engine's LOOP services (AgentWorkerService, SchedulerEngineService,
 * SupervisorService) can run in two modes:
 *   - `ENGINE_WORKER_MODE=embedded` (DEFAULT): the api process runs the loops
 *     in-process, exactly as before — zero behavior change.
 *   - `ENGINE_WORKER_MODE=separate`: the loops run ONLY in the dedicated
 *     worker process (`node dist/worker-main.js`, which sets
 *     `ENGINE_IS_WORKER=true`); the api process serves REST + enqueues but
 *     does not consume. This is the HA story: crash the worker, the api
 *     stays up; scale workers horizontally against the same Redis queue.
 *
 * `engineLoopsRunHere()` is the single source of truth every loop service
 * consults at init (and in its health shape, so the api honestly reports
 * the loop as disabled/deferred instead of pretending it runs).
 */
export function engineLoopsRunHere(): boolean {
  if (process.env.ENGINE_WORKER_MODE !== "separate") return true; // embedded default
  return process.env.ENGINE_IS_WORKER === "true";
}

/** True when this process is the dedicated worker entrypoint. */
export function isDedicatedWorkerProcess(): boolean {
  return process.env.ENGINE_IS_WORKER === "true";
}
