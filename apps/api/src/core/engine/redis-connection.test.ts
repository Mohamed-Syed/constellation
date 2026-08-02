import { describe, expect, it } from "vitest";
import {
  REDIS_CONNECT_TIMEOUT_MS,
  REDIS_MAX_RETRIES,
  boundedRetryStrategy,
  buildProbeRedisOptions,
  buildRedisConnectionOptions,
  parseRedisUrl,
} from "./redis-connection.js";

describe("parseRedisUrl", () => {
  it("defaults to localhost:6379 db 0 for a bare URL", () => {
    expect(parseRedisUrl("redis://localhost:6379")).toEqual({
      host: "localhost",
      port: 6379,
      password: undefined,
      db: 0,
    });
  });

  it("parses a full URL with password and db", () => {
    expect(parseRedisUrl("redis://:s3cret@redis.internal:6380/2")).toEqual({
      host: "redis.internal",
      port: 6380,
      password: "s3cret",
      db: 2,
    });
  });

  it("falls back to localhost defaults for an unparseable URL", () => {
    expect(parseRedisUrl("not a url at all")).toEqual({
      host: "localhost",
      port: 6379,
      db: 0,
    });
  });

  it("handles a missing port and missing db", () => {
    expect(parseRedisUrl("redis://myhost")).toEqual({
      host: "myhost",
      port: 6379,
      password: undefined,
      db: 0,
    });
  });
});

describe("buildRedisConnectionOptions (fail-fast)", () => {
  it("keeps the parsed host/port/password/db", () => {
    const opts = buildRedisConnectionOptions("redis://:pw@host:6380/3");
    expect(opts.host).toBe("host");
    expect(opts.port).toBe(6380);
    expect(opts.password).toBe("pw");
    expect(opts.db).toBe(3);
  });

  it("bounds the connect and disables the offline queue so calls fail fast", () => {
    const opts = buildRedisConnectionOptions("redis://localhost:6379");
    expect(opts.connectTimeout).toBe(REDIS_CONNECT_TIMEOUT_MS);
    expect(opts.enableOfflineQueue).toBe(false);
    // NOTE: no maxRetriesPerRequest — bullmq 6.x overrides it to null on its
    // own blocking connections and warns if set; the bound is retryStrategy.
    expect("maxRetriesPerRequest" in opts).toBe(false);
  });
});

describe("boundedRetryStrategy", () => {
  it("returns a small backoff for the first attempts", () => {
    expect(boundedRetryStrategy(1)).toBe(200);
    expect(boundedRetryStrategy(2)).toBe(400);
    expect(boundedRetryStrategy(3)).toBe(600); // well under the 20s default ceiling
  });

  it("returns null (give up) after REDIS_MAX_RETRIES — the retry-forever fix", () => {
    expect(boundedRetryStrategy(REDIS_MAX_RETRIES + 1)).toBeNull();
    expect(boundedRetryStrategy(99)).toBeNull();
  });
});

describe("buildProbeRedisOptions", () => {
  it("is lazyConnect with zero retries — deterministic fast probe", () => {
    const opts = buildProbeRedisOptions("redis://localhost:6379");
    expect(opts.lazyConnect).toBe(true);
    expect(opts.retryStrategy()).toBeNull();
    expect(opts.connectTimeout).toBe(REDIS_CONNECT_TIMEOUT_MS);
    expect(opts.enableOfflineQueue).toBe(false);
    expect(opts.maxRetriesPerRequest).toBe(1);
  });
});
