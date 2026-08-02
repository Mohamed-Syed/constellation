import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, type ConnectionOptions } from "bullmq";

export const ENGINE_QUEUE_NAME = "engine-tasks";

/**
 * Single-node Redis connection shape. bullmq 6.x's own `ConnectionOptions`
 * is a union that also covers Cluster/Sentinel configs (no `.host`/`.port`
 * on those variants), so we keep our own narrow type here and hand it to
 * bullmq as `ConnectionOptions` at the call site — we only ever build the
 * single-node shape.
 */
interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db: number;
}

function parseRedisUrl(url: string): RedisConnectionOptions {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || "localhost",
      port: Number(u.port) || 6379,
      password: u.password || undefined,
      db: u.pathname ? Number(u.pathname.slice(1)) || 0 : 0,
    };
  } catch {
    return { host: "localhost", port: 6379, db: 0 };
  }
}

/**
 * BullMQ queue producer. Enqueues an engine job by taskId; the
 * AgentWorkerService holds the consumer (Worker) side.
 *
 * Lifecycle: queue is created in onModuleInit and closed in onModuleDestroy
 * so NestJS teardown doesn't leave open Redis connections.
 */
@Injectable()
export class TaskQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskQueueService.name);
  private queue!: Queue;
  private readonly connection: RedisConnectionOptions;

  constructor(private readonly config: ConfigService) {
    this.connection = parseRedisUrl(config.get("REDIS_URL", "redis://localhost:6379"));
  }

  onModuleInit() {
    this.queue = new Queue(ENGINE_QUEUE_NAME, { connection: this.connection as ConnectionOptions });
    this.logger.log(`Queue "${ENGINE_QUEUE_NAME}" initialised (${this.connection.host}:${this.connection.port})`);
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }

  async enqueue(taskId: string, priority = 0): Promise<void> {
    await this.queue.add("run", { taskId }, {
      priority,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 604800 },
    });
    this.logger.log(`Enqueued task ${taskId}`);
  }

  async getHealth() {
    const [waiting, active, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getFailedCount(),
    ]);
    return { queue: ENGINE_QUEUE_NAME, waiting, active, failed };
  }
}
