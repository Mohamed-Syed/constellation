/**
 * Shared Redis connection helpers for the engine (BullMQ queue + worker).
 *
 * Centralises three things that were previously copy-pasted between
 * `task-queue.service.ts` and `agent-worker.service.ts`:
 *
 *  1. `RedisConnectionOptions` — the narrow single-node connection shape we
 *     build (bullmq 6.x's own `ConnectionOptions` is a union that also
 *     covers Cluster/Sentinel configs with no `.host`/`.port`; we only ever
 *     build the single-node shape and cast at the bullmq call site).
 *  2. `parseRedisUrl` — `redis://[user][:password@]host[:port][/db]` → the
 *     shape above, with sane localhost defaults.
 *  3. FAIL-FAST ioredis options (`buildRedisConnectionOptions`). This is the
 *     Engine v0.1 hardening: ioredis/bullmq defaults retry `ECONNREFUSED`
 *     forever (exponential backoff capped at 20s), so a missing Redis turns
 *     into a log flood and a hanging `queue.add()`. Our options bound the
 *     retries (a few quick attempts, then give up), bound the initial
 *     connect, and disable the offline command queue so a call against a
 *     dead Redis rejects fast instead of buffering forever. The engine then
 *     degrades exactly like the rest of the platform (see
 *     `EngineAvailabilityService`): it disables itself with an honest reason
 *     instead of hanging.
 *
 * NOTE on bullmq 6.x: it forces `maxRetriesPerRequest = null` on its own
 * blocking (Worker) connections regardless of what we pass, but it KEEPS our
 * `retryStrategy` — which is the field that actually stops the
 * retry-forever loop. `maxRetriesPerRequest: 1` still applies to the
 * producer (Queue) connection and to our availability probe.
 */

/** The narrow single-node Redis connection shape (see header comment). */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db: number;
}

/** How many reconnect attempts before ioredis gives up (then `null` → stop). */
export const REDIS_MAX_RETRIES = 3;

/** Bound on the initial TCP connect (ms). */
export const REDIS_CONNECT_TIMEOUT_MS = 3000;

/** Parse a `redis://` URL into the connection shape. Never throws. */
export function parseRedisUrl(url: string): RedisConnectionOptions {
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

/** ioredis `retryStrategy`: a few quick attempts, then give up. */
export function boundedRetryStrategy(times: number): number | null {
  if (times > REDIS_MAX_RETRIES) return null;
  return Math.min(times * 200, 1000);
}

/**
 * Fail-fast ioredis connection options for the BullMQ Queue/Worker.
 * Compatible with bullmq's `ConnectionOptions` (cast at the call site).
 *
 * NOTE: no `maxRetriesPerRequest` here on purpose — bullmq 6.x overrides it
 * to `null` on its own (blocking) connections and warns loudly if you set
 * it. The retry-forever fix comes from the bounded `retryStrategy` plus
 * `enableOfflineQueue:false` + `connectTimeout`.
 */
export function buildRedisConnectionOptions(url: string): RedisConnectionOptions & {
  connectTimeout: number;
  enableOfflineQueue: boolean;
  retryStrategy: (times: number) => number | null;
} {
  const { host, port, password, db } = parseRedisUrl(url);
  return {
    host,
    port,
    password,
    db,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    enableOfflineQueue: false,
    retryStrategy: boundedRetryStrategy,
  };
}

/**
 * Even more aggressive options for the boot-time availability PROBE: never
 * retry, never buffer commands, and do not connect until asked
 * (`lazyConnect`). `EngineAvailabilityService` uses this so a dead Redis
 * yields a fast, deterministic "unavailable" verdict instead of a hang.
 */
export function buildProbeRedisOptions(url: string): {
  host: string;
  port: number;
  password?: string;
  db: number;
  lazyConnect: boolean;
  connectTimeout: number;
  maxRetriesPerRequest: number;
  enableOfflineQueue: boolean;
  retryStrategy: () => null;
} {
  const { host, port, password, db } = parseRedisUrl(url);
  return {
    host,
    port,
    password,
    db,
    lazyConnect: true,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  };
}
