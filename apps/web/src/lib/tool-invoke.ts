import type { PluginSummary } from "./types";
import { API_BASE } from "./api-base";

/**
 * Invoke an agent-plane tool exposed by a plugin.
 *
 * CONTRACT (see `apps/api/src/core/plugins/plugins.controller.ts` +
 * `plugin-tool.service.ts`, added in the P3/P4 slice):
 *
 *   POST /api/plugins/:id/invoke
 *   Authorization: Bearer <token>
 *   body: { "tool": "<toolName>", "args"?: Record<string, unknown> }
 *   → 200 { pluginId, tool, durationMs, ...ToolResult }   // ToolResult = { ok, ... }
 *          (a tool returning { ok:false } is STILL HTTP 200 — it's a completed call)
 *   → 401 / 403  forbidden (lacks core:plugin:manage or the tool's own permission)
 *   → 404  plugin or tool not declared
 *   → 409  plugin not enabled
 *   → 400  invalid body
 *
 * Authorization is TWO-LAYERED: the route requires `core:plugin:manage`, and
 * `PluginToolService` additionally enforces the tool's manifest `permission`.
 * We never throw to the caller: a discriminated result drives the form's UI.
 */
export type InvokeOutcome =
  | { ok: true; result: unknown; durationMs?: number }
  | {
      ok: false;
      reason: "unauthenticated" | "forbidden" | "not-found" | "not-enabled" | "bad-args" | "unreachable" | "tool-error" | "unknown";
      message: string;
    };

export async function invokeTool(
  pluginId: string,
  toolName: string,
  args: Record<string, unknown>,
  token: string | null,
): Promise<InvokeOutcome> {
  if (!token) {
    return { ok: false, reason: "unauthenticated", message: "You must be signed in to invoke tools." };
  }
  try {
    const res = await fetch(`${API_BASE}/plugins/${encodeURIComponent(pluginId)}/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tool: toolName, args }),
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "forbidden", message: "You don't have permission to invoke this tool." };
    }
    if (res.status === 404) {
      return { ok: false, reason: "not-found", message: "This plugin or tool wasn't found on the server." };
    }
    if (res.status === 409) {
      return { ok: false, reason: "not-enabled", message: "This plugin isn't enabled — its tools are unavailable." };
    }
    if (res.status === 400) {
      return { ok: false, reason: "bad-args", message: "The request was rejected (invalid arguments)." };
    }
    if (!res.ok) {
      return { ok: false, reason: "unknown", message: `Invocation failed (HTTP ${res.status}).` };
    }

    const body = (await res.json()) as { tool: string; durationMs?: number; ok?: boolean; error?: string; result?: unknown };
    // The endpoint returns 200 with a ToolResult envelope ({ ok, ... }) even when
    // the tool call itself failed — so we surface the envelope as the result.
    return {
      ok: true,
      result: body.result ?? body,
      durationMs: typeof body.durationMs === "number" ? body.durationMs : undefined,
    };
  } catch {
    return { ok: false, reason: "unreachable", message: "Can't reach the Constellation API." };
  }
}

/** True when the user holds the tool's required permission (per `lib/permissions`). */
export function canInvokeTool(toolPermission: string, heldPermissions: readonly string[]): boolean {
  return heldPermissions.some((h) => {
    if (h === toolPermission) return true;
    if (h === "platform:admin") return true;
    if (h.endsWith(":*")) return toolPermission.startsWith(h.slice(0, -1));
    return false;
  });
}
