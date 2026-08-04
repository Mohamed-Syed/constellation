import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import {
  hasAllPermissions,
  type LoadedPlugin,
  type PluginManifest,
  type ToolResult,
} from "@constellation/plugin-sdk";
import { EventBusService } from "../events/event-bus.service.js";
import { buildContextWith, PluginContextFactory } from "./plugin-context.factory.js";
import { PluginRegistryService } from "./plugin-registry.service.js";
import { PluginSandboxService } from "./plugin-sandbox.service.js";
// VALUE import (not `import type`): TracingService is a DI token below; a
// type-only import is erased and @Optional() then injects undefined.
import { TracingService } from "../observability/tracing/tracing.service.js";
import type { Span } from "@opentelemetry/api";

/** No-op span handed to callbacks when tracing is disabled (never recorded). */
const NOOP_SPAN = { setAttributes: () => NOOP_SPAN } as unknown as Span;

/** A declared tool as it appears in a manifest's `tools` array. */
type DeclaredTool = PluginManifest["tools"][number];

/**
 * Why a tool invocation was rejected *before* the plugin ran. Maps to an HTTP
 * status in the controller; kept as a domain enum here so this service stays
 * transport-agnostic and unit-testable without Nest's HTTP layer.
 */
export type ToolRejection =
  | "plugin-not-found"
  | "plugin-not-enabled"
  | "tool-not-declared"
  | "not-invocable"
  | "forbidden";

export interface ToolInvocationRejected {
  outcome: "rejected";
  reason: ToolRejection;
  message: string;
  /** Set for `forbidden` — the permission the caller was missing. */
  requiredPermission?: string;
}

export interface ToolInvocationCompleted {
  outcome: "completed";
  /** The plugin's own `ToolResult` envelope — `ok:false` is still a completed call. */
  result: ToolResult;
  durationMs: number;
}

export type ToolInvocation = ToolInvocationRejected | ToolInvocationCompleted;

/** Hard ceiling on a single tool call, so one hung plugin can't pin a request forever. */
const DEFAULT_INVOCATION_TIMEOUT_MS = 120_000;

/**
 * AGENT PLANE dispatcher: the one place a plugin-declared tool actually gets
 * called. Everything here is defense applied *before* untrusted plugin code
 * runs, and containment applied around it.
 *
 * The layered checks, in order:
 *  1. The plugin exists and is `enabled` (a disabled plugin exposes no tools).
 *  2. The tool is DECLARED in the manifest. The manifest is the contract — a
 *     runtime that secretly handles an undeclared name is never reachable.
 *  3. The runtime actually implements `invokeTool`.
 *  4. **Per-tool permission.** Each tool carries its own `permission` string;
 *     the caller must hold it *in addition to* the coarse route-level
 *     `core:plugin:manage`. This is the important one: route-level RBAC alone
 *     would make every tool equally privileged, so `browser.navigate` would be
 *     no harder to call than a destructive tool. Checked with the SDK's
 *     `hasAllPermissions` so semantics (wildcards, `platform:admin`) match the
 *     rest of the platform exactly.
 *  5. Timeout + try/catch containment: a plugin that throws or hangs yields a
 *     clean `ok:false` envelope, never a 500 and never a wedged request.
 *
 * Both `PluginContextFactory` and `EventBusService` are injected `@Optional()`
 * — the established pattern in this module — so the hand-wired offline unit
 * tests can construct this service with no Nest DI container. Context building
 * goes through `buildContextWith`, which falls back to `stubContext`.
 */
@Injectable()
export class PluginToolService {
  private readonly logger = new Logger(PluginToolService.name);

  constructor(
    private readonly registry: PluginRegistryService,
    @Optional() private readonly contextFactory?: PluginContextFactory,
    @Optional() private readonly events?: EventBusService,
    @Optional() @Inject(TracingService) private readonly tracing?: TracingService,
    // Phase 2.0 2.7 — process-mode sandbox. `@Optional()` + trailing position
    // keeps the hand-wired offline tests (which construct positionally)
    // green: absent → in-process dispatch, exactly as before.
    @Optional() private readonly sandbox?: PluginSandboxService,
  ) {}

  /** Declared tools for a plugin, or `[]` when unknown. Read-only view. */
  listTools(pluginId: string): DeclaredTool[] {
    return this.registry.get(pluginId)?.manifest.tools ?? [];
  }

  /**
   * Resolve, authorize, and dispatch one tool call.
   *
   * @param callerPermissions Flattened permissions of the authenticated caller.
   *   Pass `["platform:admin"]` for trusted internal/system callers.
   */
  async invoke(
    pluginId: string,
    toolName: string,
    args: Record<string, unknown>,
    callerPermissions: readonly string[],
  ): Promise<ToolInvocation> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      return reject("plugin-not-found", `No plugin "${pluginId}"`);
    }

    if (plugin.state !== "enabled") {
      return reject(
        "plugin-not-enabled",
        `Plugin "${pluginId}" is "${plugin.state}", not enabled — its tools are unavailable.`,
      );
    }

    const tool = plugin.manifest.tools.find((t) => t.name === toolName);
    if (!tool) {
      const declared = plugin.manifest.tools.map((t) => t.name);
      return reject(
        "tool-not-declared",
        `Plugin "${pluginId}" does not declare a tool "${toolName}".` +
          (declared.length ? ` Declared: ${declared.join(", ")}.` : " It declares no tools."),
      );
    }

    if (typeof plugin.runtime.invokeTool !== "function") {
      return reject(
        "not-invocable",
        `Plugin "${pluginId}" declares tool "${toolName}" but its runtime implements no invokeTool().`,
      );
    }

    // Per-tool authorization — the finest-grained check, applied last before dispatch.
    if (tool.permission && !hasAllPermissions(callerPermissions, [tool.permission])) {
      this.logger.warn(
        `Denied tool "${pluginId}/${toolName}" — caller lacks "${tool.permission}"`,
      );
      return {
        outcome: "rejected",
        reason: "forbidden",
        message: `Calling "${toolName}" requires the "${tool.permission}" permission.`,
        requiredPermission: tool.permission,
      };
    }

    return this.withToolSpan(pluginId, toolName, async (span) => {
      const result = await this.dispatch(plugin, tool, args);
      // Honest outcome attribute: ok / error (a completed call that failed
      // inside the plugin). Args are NEVER logged or attributed — same rule
      // as the audit trail. (Rejections never reach dispatch — they return
      // earlier, so no span is created for an unauthorized call.)
      span.setAttributes({ "tool.outcome": result.result.ok ? "ok" : "error" });
      return result;
    });
  }

  /** OTel span around one tool dispatch (additive — no-op when disabled). */
  private withToolSpan<T>(
    pluginId: string,
    toolName: string,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    if (!this.tracing) return fn(NOOP_SPAN);
    return this.tracing.withSpan(
      "plugin.tool.invoke",
      { "plugin.id": pluginId, "tool.name": toolName },
      fn,
    );
  }

  /**
   * Runs the plugin's `invokeTool` — IN-PROCESS (the default) or in the
   * process-mode SANDBOX (Phase 2.0 2.7) when the operator opted the plugin
   * in (PLUGIN_SANDBOX_MODE=process + PLUGIN_SANDBOX_PLUGINS). Both paths
   * convert any throw/hang/crash into `ok:false`; the sandbox path adds
   * OS-level isolation (timeout kill, heap cap, result cap, crash
   * containment) so a bad plugin can never take down the api.
   */
  private async dispatch(
    plugin: LoadedPlugin,
    tool: DeclaredTool,
    args: Record<string, unknown>,
  ): Promise<ToolInvocationCompleted> {
    const pluginId = plugin.manifest.id;
    const startedAt = Date.now();
    let result: ToolResult;

    try {
      if (this.sandbox?.shouldSandbox(pluginId)) {
        result = await this.sandbox.dispatch(plugin, tool.name, args);
      } else {
        const ctx = await buildContextWith(this.contextFactory, plugin.manifest);
        result = await withTimeout(
          Promise.resolve(plugin.runtime.invokeTool!(tool.name, args, ctx)),
          DEFAULT_INVOCATION_TIMEOUT_MS,
          `tool "${tool.name}" exceeded ${DEFAULT_INVOCATION_TIMEOUT_MS}ms`,
        );
      }

      // A runtime returning junk shouldn't corrupt the envelope contract.
      if (!result || typeof result !== "object" || typeof (result as ToolResult).ok !== "boolean") {
        result = {
          ok: false,
          error: `Plugin "${pluginId}" returned a malformed ToolResult for "${tool.name}".`,
        };
      }
    } catch (err) {
      // Containment: a throwing tool is a failed CALL, never a failed plugin.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Tool "${pluginId}/${tool.name}" threw: ${message}`);
      result = { ok: false, error: message };
    }

    const durationMs = Date.now() - startedAt;

    // Observability seam for Atlas/the orchestrator. Never let a listener
    // failure break the call that succeeded.
    try {
      this.events?.emitPlatform("plugin:tool:invoked", {
        pluginId,
        tool: tool.name,
        ok: result.ok,
        durationMs,
      });
    } catch {
      /* event bus is best-effort */
    }

    return { outcome: "completed", result, durationMs };
  }
}

function reject(reason: ToolRejection, message: string): ToolInvocationRejected {
  return { outcome: "rejected", reason, message };
}

/** Rejects with an Error after `ms`; the dispatcher converts that into `ok:false`. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject_) => {
    const timer = setTimeout(() => reject_(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject_(e);
      },
    );
  });
}
