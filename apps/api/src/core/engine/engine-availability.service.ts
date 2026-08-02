import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { buildProbeRedisOptions, parseRedisUrl } from "./redis-connection.js";

/**
 * Thrown when the engine's Redis backend is unavailable. Callers (the
 * EngineController) map this to a clean HTTP 503 "engine unavailable"
 * response — never a hang, never a log flood.
 */
export class EngineUnavailableError extends Error {
  constructor(reason: string) {
    super(`Engine unavailable: ${reason}`);
    this.name = "EngineUnavailableError";
  }
}

/**
 * Engine v0.1 hardening — makes the durable task runtime degrade like the
 * rest of the platform (mirrors `PrismaService.isConnected`):
 *
 *  - If `REDIS_URL` is unset, the engine is disabled with an honest reason.
 *  - If Redis is unreachable at boot, the engine is disabled with an honest
 *    reason (the probe uses a FAIL-FAST ioredis client — bounded connect
 *    timeout, no retries — so a dead Redis is a fast verdict, not a hang).
 *  - `TaskQueueService` / `AgentWorkerService` consult `isEnabled` before
 *    constructing their BullMQ Queue/Worker, so a missing Redis no longer
 *    means "ioredis retries ECONNREFUSED forever in the background".
 *  - `refresh()` lets a future admin route re-probe after the backend comes
 *    back, without a process restart.
 *
 * The probe client is created with `lazyConnect` and a noop `error` listener
 * (ioredis re-emits connection failures as `error` events; without a
 * listener an early failure would be an uncaught exception even though we
 * also handle the rejected `connect()` promise).
 */
@Injectable()
export class EngineAvailabilityService implements OnModuleInit {
  private readonly logger = new Logger(EngineAvailabilityService.name);
  private enabled = false;
  private reasonText = "Redis availability not yet checked";
  private probePromise: Promise<void> | null = null;
  private readonly redisUrl: string;
  private readonly endpoint: string;

  constructor(private readonly config: ConfigService) {
    this.redisUrl = (config.get("REDIS_URL") as string | undefined) ?? "";
    const parsed = parseRedisUrl(this.redisUrl || "redis://localhost:6379");
    this.endpoint = `${parsed.host}:${parsed.port}`;
  }

  /** True when the engine's Redis backend is reachable and the queue can run. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Human-readable reason when unavailable; `null` when the engine is ready. */
  get reason(): string | null {
    return this.enabled ? null : this.reasonText;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureProbed();
  }

  /**
   * Runs the probe exactly once and shares the result. NestJS calls
   * `onModuleInit` hooks in provider-declaration order (not dependency
   * order), so TaskQueueService/AgentWorkerService may init BEFORE this
   * service's own hook fires. They call `ensureProbed()` at the top of
   * their own init, so whoever runs first triggers the single probe and
   * every consumer sees the same verdict — ordering-independent.
   */
  ensureProbed(): Promise<void> {
    if (!this.probePromise) {
      // refresh() never rejects (all paths are caught), so the cached
      // promise is always a resolved one.
      this.probePromise = this.refresh();
    }
    return this.probePromise;
  }

  /**
   * Probe Redis with a fail-fast client and update availability. Idempotent
   * and safe to call again later (e.g. after Redis comes back).
   */
  async refresh(): Promise<void> {
    if (!this.redisUrl) {
      this.enabled = false;
      this.reasonText = "REDIS_URL is not set — engine queue disabled";
      this.logger.warn(this.reasonText);
      return;
    }

    let client: Redis | undefined;
    try {
      client = new Redis(this.redisUrl, buildProbeRedisOptions(this.redisUrl));
      // Prevent an uncaught 'error' event from an early connection failure.
      client.on("error", () => {
        /* handled via the rejected connect()/ping() promise below */
      });
      await client.connect();
      await client.ping();
      this.enabled = true;
      this.reasonText = "ready";
      this.logger.log(`Engine queue backend reachable at ${this.endpoint}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.enabled = false;
      this.reasonText = `Redis unreachable at ${this.endpoint}: ${msg}`;
      this.logger.warn(`Engine queue disabled — ${this.reasonText}`);
    } finally {
      client?.disconnect();
    }
  }
}
