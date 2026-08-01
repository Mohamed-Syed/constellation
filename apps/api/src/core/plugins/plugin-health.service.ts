import { Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { HealthResult } from "@constellation/plugin-sdk";
import { buildContextWith, PluginContextFactory } from "./plugin-context.factory.js";
import { PluginRegistryService } from "./plugin-registry.service.js";

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Background health poller. On a configurable interval, calls every enabled
 * plugin's `health()` hook and stores the result on the registry. A plugin
 * that omits `health()` is reported "ok" (per the SDK contract's default). A
 * plugin whose `health()` throws or exceeds the timeout is recorded "down" —
 * this NEVER throws out of the poll loop and never touches lifecycle `state`.
 *
 * Configure via env: PLUGIN_HEALTH_POLL_INTERVAL_MS (0 disables polling),
 * PLUGIN_HEALTH_POLL_TIMEOUT_MS.
 */
@Injectable()
export class PluginHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PluginHealthService.name);
  private timer?: ReturnType<typeof setInterval>;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly registry: PluginRegistryService,
    @Optional() private readonly contextFactory?: PluginContextFactory,
  ) {
    this.intervalMs = numberFromEnv("PLUGIN_HEALTH_POLL_INTERVAL_MS", DEFAULT_INTERVAL_MS);
    this.timeoutMs = numberFromEnv("PLUGIN_HEALTH_POLL_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  }

  onModuleInit(): void {
    if (this.intervalMs <= 0) {
      this.logger.warn("Plugin health polling disabled (PLUGIN_HEALTH_POLL_INTERVAL_MS <= 0)");
      return;
    }
    this.timer = setInterval(() => {
      void this.pollAll();
    }, this.intervalMs);
    this.timer.unref?.(); // never keep the process alive just for polling
    void this.pollAll(); // first pass immediately so /api/health is fresh right after boot
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async pollAll(): Promise<void> {
    const targets = this.registry.byState("enabled");
    await Promise.all(targets.map((p) => this.pollOne(p.manifest.id)));
  }

  /** Poll a single plugin's health() hook, isolated from the rest of the loop. */
  async pollOne(id: string): Promise<HealthResult> {
    const p = this.registry.get(id);
    if (!p) {
      const result: HealthResult = { status: "down", detail: "not registered" };
      return result;
    }
    try {
      const ctx = await buildContextWith(this.contextFactory, p.manifest);
      const result = p.runtime.health
        ? await this.withTimeout(p.runtime.health(ctx), this.timeoutMs, id)
        : ({ status: "ok" } as const);
      this.registry.setHealth(id, result);
      if (result.status !== "ok") {
        this.logger.warn(`Plugin "${id}" health: ${result.status}${result.detail ? ` — ${result.detail}` : ""}`);
      }
      return result;
    } catch (err) {
      const result: HealthResult = { status: "down", detail: `health() failed: ${asMessage(err)}` };
      this.registry.setHealth(id, result);
      this.logger.warn(`Plugin "${id}" health check failed: ${result.detail}`);
      return result;
    }
  }

  private withTimeout<T>(value: T | Promise<T>, ms: number, id: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`health() for "${id}" timed out after ${ms}ms`)), ms);
      Promise.resolve(value).then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
