const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

/**
 * Invoke an agent-plane tool exposed by a plugin.
 *
 * CONTRACT (documented, not yet implemented server-side as of this writing —
 * see `apps/api/src/core/plugins/plugins.controller.ts`'s `toDetail()` which
 * notes "invoking a tool is a separate, permission-checked route (later
 * round)"). We build the UI against the expected shape:
 *
 *   POST /api/plugins/:id/tools/:toolName/invoke
 *   Authorization: Bearer <token>
 *   body: { args: Record<string, unknown> }
 *   → 200 { ok: true, result: unknown }
 *   → 401/403 if the caller lacks the tool's `permission`
 *   → 404 if the tool or the invoke route doesn't exist yet (expected today)
 *   → 400 { ok:false, error } for invalid args, surfaced to the form
 *
 * We never throw to the caller: a discriminated result drives the form's UI,
 * and a 404 cleanly flips the form into a "coming soon" state.
 */
export type InvokeOutcome =
  | { ok: true; result: unknown }
  | { ok: false; reason: "unauthenticated" | "unauthorized" | "not-found" | "bad-args" | "unreachable" | "unknown"; message: string };

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
    const res = await fetch(
      `${API_BASE}/plugins/${encodeURIComponent(pluginId)}/tools/${encodeURIComponent(toolName)}/invoke`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ args }),
      },
    );
    if (res.status === 404) {
      // The invoke route isn't wired yet (expected) — degrade to "coming soon".
      return { ok: false, reason: "not-found", message: "Tool invocation isn't available yet." };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "unauthorized", message: "You don't have permission to invoke this tool." };
    }
    if (res.status === 400) {
      const body = (await safeJson(res)) as { error?: string } | null;
      return { ok: false, reason: "bad-args", message: body?.error ?? "Invalid arguments." };
    }
    if (!res.ok) {
      return { ok: false, reason: "unknown", message: `Invocation failed (HTTP ${res.status}).` };
    }
    const body = (await safeJson(res)) as { result?: unknown } | null;
    return { ok: true, result: body?.result ?? null };
  } catch {
    return { ok: false, reason: "unreachable", message: "Can't reach the Constellation API." };
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** True when the user holds the tool's required permission (per `lib/permissions`). */
export function canInvokeTool(toolPermission: string, heldPermissions: readonly string[]): boolean {
  // Re-implement the match inline to avoid a circular import with permissions.ts.
  const has = (required: string): boolean =>
    heldPermissions.some((h) => {
      if (h === required) return true;
      if (h === "platform:admin") return true;
      if (h.endsWith(":*")) return required.startsWith(h.slice(0, -1));
      return false;
    });
  return has(toolPermission);
}
