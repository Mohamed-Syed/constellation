import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, type ConnectionOptions } from "bullmq";
import { EngineAvailabilityService, EngineUnavailableError } from "./engine-availability.service.js";
import { buildRedisConnectionOptions } from "./redis-connection.js";

export const ENGINE_QUEUE_NAME = "engine-tasks";

/**
 * BullMQ queue producer. Enqueues an engine job by taskId; the
 * AgentWorkerService holds the consumer (Worker) side.
 *
 * Engine v0.1 hardening (see EngineAvailabilityService): the Queue is only
 * constructed when Redis is reachable. With Redis down (or REDIS_URL unset)
 * the engine degrades cleanly — `enqueue()` throws EngineUnavailableError
 * (mapped to a 503 by the controller) instead of hanging, and `getHealth()`
 * reports `enabled:false` with the reason. The connection options are
 * fail-fast (bounded retryStrategy, connect timeout, no offline queue), so
 * a Redis that dies after boot also fails fast instead of retrying forever.
 */
@Injectable()
export class TaskQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskQueueService.name);
  private queue: Queue | undefined;
  private readonly connection: ReturnType<typeof buildRedisConnectionOptions>;

  constructor(
    private readonly config: ConfigService,
    private readonly availability: EngineAvailabilityService,
  ) {
    this.connection = buildRedisConnectionOptions(config.get("REDIS_URL", "redis://localhost:6379"));
  }

  async onModuleInit() {
    // NestJS runs onModuleInit hooks in declaration order, not dependency
    // order — this service may init before EngineAvailabilityService's own
    // hook. ensureProbed() triggers the shared single probe, so whichever
    // init runs first produces the verdict for everyone.
    await this.availability.ensureProbed();
    if (!this.availability.isEnabled) {
      this.logger.warn(`Queue "${ENGINE_QUEUE_NAME}" NOT started — ${this.availability.reason}`);
      return;
    }
    this.queue = new Queue(ENGINE_QUEUE_NAME, { connection: this.connection as ConnectionOptions });
    this.logger.log(
      `Queue "${ENGINE_QUEUE_NAME}" initialised (${this.connection.host}:${this.connection.port})`,
    );
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }

  /**
   * Guard for callers: throws when the engine backend is unavailable so they
   * can map it to a clean 503. Also covers the narrow window where Redis
   * died after boot (queue constructed but now failing fast).
   */
  assertAvailable(): void {
    if (!this.availability.isEnabled) {
      throw new EngineUnavailableError(this.availability.reason ?? "engine queue disabled");
    }
    if (!this.queue) {
      throw new EngineUnavailableError("engine queue not initialised");
    }
  }

  async enqueue(taskId: string, priority = 0): Promise<void> {
    this.assertAvailable();
    try {
      await this.queue!.add("run", { taskId }, {
        priority,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      });
      this.logger.log(`Enqueued task ${taskId}`);
    } catch (err) {
      // Redis died after boot — fail fast and honestly, don't retry forever.
      const msg = err instanceof Error ? err.message : String(err);
      throw new EngineUnavailableError(`could not enqueue task ${taskId}: ${msg}`);
    }
  }

  /**
   * Engine v0.5 — supervisor race guard. Returns the set of taskIds that an
   * ACTIVE BullMQ job is currently working right now. The supervisor refuses
   * to re-enqueue (or fail) a stale-looking `running` task whose id appears
   * here — the worker is demonstrably alive on it, so acting would double-run
   * a live task. Returns an empty set when unavailable.
   */
  async getActiveTaskIds(): Promise<Set<string>> {
    if (!this.availability.isEnabled || !this.queue) return new Set<string>();
    try {
      const active = await this.queue.getActive(0, 1000);
      const ids = new Set<string>();
      for (const job of active) {
        const taskId = (job?.data as { taskId?: string } | undefined)?.taskId;
        if (taskId) ids.add(taskId);
      }
      return ids;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not read active jobs for supervision: ${msg}`);
      return new Set<string>();
    }
  }

  /**
   * Health of the queue producer. When the engine is disabled the shape is
   * `{ enabled:false, reason }`; when enabled it matches the v0 shape
   * (`queue` + the three BullMQ counters) so existing consumers keep working.
   */
  async getHealth() {
    if (!this.availability.isEnabled || !this.queue) {
      return { enabled: false, reason: this.availability.reason ?? "engine queue not initialised" };
    }
    const [waiting, active, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getFailedCount(),
    ]);
    return { enabled: true, queue: ENGINE_QUEUE_NAME, waiting, active, failed };
  }
}
