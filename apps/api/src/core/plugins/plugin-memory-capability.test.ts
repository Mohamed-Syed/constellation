import { describe, expect, it, vi } from "vitest";
import { CorePermissions, type PluginManifest } from "@constellation/plugin-sdk";
import type { BrainService } from "../memory/brain.service.js";
import { PluginContextFactory } from "./plugin-context.factory.js";
import type { PluginLoggerFactory } from "../logging/plugin-logger.factory.js";
import type { PluginConfigFactory } from "../settings/plugin-config.factory.js";
import type { EventBusService } from "../events/event-bus.service.js";
import type { PrismaService } from "../database/prisma.service.js";

/**
 * The `memory` capability is a SECURITY surface: it hands plugin code a write
 * path into the platform's memory. These tests pin the least-privilege rule —
 * the capability appears only for a plugin that declared `core:brain:*`, and
 * each method is gated on the specific permission it needs.
 */

function manifest(permissions: string[]): PluginManifest {
  return {
    manifestVersion: 1,
    id: "memo",
    name: "Memo",
    version: "1.0.0",
    description: "",
    author: "",
    license: "UNLICENSED",
    minPlatformVersion: "0.1.0",
    dependencies: [],
    requiredServices: [],
    permissions,
    navigation: [],
    routes: [],
    featureFlags: [],
    settings: [],
    jobs: [],
    tools: [],
    entry: "dist/index.js",
    healthCheck: "/health",
    translations: [],
  } as PluginManifest;
}

function factory(brain?: BrainService): PluginContextFactory {
  const logger = { forPlugin: () => ({ debug() {}, info() {}, warn() {}, error() {}, child() {} }) };
  const config = { forPlugin: async () => ({ get: () => undefined, getOrThrow: () => "", isFeatureEnabled: () => false }) };
  const events = { forPlugin: () => ({ emit() {}, on() {}, onPlatform() {} }) };
  const prisma = { queryInSchema: async () => [] };
  return new PluginContextFactory(
    logger as unknown as PluginLoggerFactory,
    config as unknown as PluginConfigFactory,
    events as unknown as EventBusService,
    prisma as unknown as PrismaService,
    brain,
  );
}

function fakeBrain(): BrainService {
  return {
    remember: vi.fn(async () => undefined),
    query: vi.fn(async () => ({ answer: "a", provenance: [], grounded: false })),
    stats: vi.fn(async () => ({ nodes: 0, edges: 0, lastBuiltAt: null, available: false, vaultNotes: 0 })),
  } as unknown as BrainService;
}

describe("PluginContextFactory — memory capability", () => {
  it("omits ctx.memory when the plugin declared no brain permission", async () => {
    const ctx = await factory(fakeBrain()).build(manifest(["core:authenticated"]));
    expect(ctx.memory).toBeUndefined();
  });

  it("omits ctx.memory when no BrainService is wired (memory module absent)", async () => {
    const ctx = await factory(undefined).build(manifest([CorePermissions.BRAIN_READ]));
    expect(ctx.memory).toBeUndefined();
  });

  it("grants read-only memory for a plugin declaring core:brain:read", async () => {
    const brain = fakeBrain();
    const ctx = await factory(brain).build(manifest([CorePermissions.BRAIN_READ]));
    expect(ctx.memory).toBeDefined();
    await ctx.memory!.query("q");
    await ctx.memory!.stats();
    expect(brain.query).toHaveBeenCalledWith("q");
    expect(brain.stats).toHaveBeenCalled();
    await expect(ctx.memory!.remember({ title: "t", body: "b" })).rejects.toThrow(/core:brain:write/);
    expect(brain.remember).not.toHaveBeenCalled();
  });

  it("grants write-only memory for a plugin declaring only core:brain:write", async () => {
    const brain = fakeBrain();
    const ctx = await factory(brain).build(manifest([CorePermissions.BRAIN_WRITE]));
    await ctx.memory!.remember({ title: "t", body: "b" });
    expect(brain.remember).toHaveBeenCalled();
    await expect(ctx.memory!.query("q")).rejects.toThrow(/core:brain:read/);
  });

  it("honours a wildcard declaration (core:*)", async () => {
    const brain = fakeBrain();
    const ctx = await factory(brain).build(manifest(["core:*"]));
    await ctx.memory!.remember({ title: "t", body: "b" });
    await ctx.memory!.query("q");
    expect(brain.remember).toHaveBeenCalled();
    expect(brain.query).toHaveBeenCalled();
  });
});
