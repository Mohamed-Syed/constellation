/**
 * Federated tool catalog — the P3 "portal federation" surface (client side).
 *
 * Heavyweight tools (Grafana, Langflow, Open WebUI, Coolify, …) are NOT bundled
 * into the core. They are declared in the API's `config/modules.yaml` and served
 * by the core as `GET /api/federation/modules`. This module is the portal-side
 * client: it fetches that endpoint (authenticated) and renders each module as a
 * tile that opens the tool's proxied `path` (behind one SSO session).
 *
 * CONTRACT (see `apps/api/src/core/federation/federation.controller.ts`):
 *   GET /api/federation/modules  (Bearer; guarded by global JwtAuthGuard)
 *     → FederatedModuleDto[]  (upstream/internal fields already stripped server-side)
 *   GET /api/federation/modules/:id
 *   GET /api/federation/status  (PLATFORM_ADMIN only)
 *
 * The portal NEVER parses `modules.yaml` itself — that's the API's job, and the
 * API degrades to an empty list on a missing/malformed registry. Our client does
 * the same: any fetch failure (no token, 401/403, API down) yields `[]` so the
 * portal shell always renders. No endpoints are invented here.
 */

import { API_BASE } from "./api-base";

/** Mirror of `FederatedModuleDto` returned by `GET /api/federation/modules`. */
export interface FederatedTool {
  id: string;
  name: string;
  description: string;
  /** Grouping label, e.g. "observability". */
  category: string;
  /** Lucide icon name (matches `lib/icons.ts`). */
  icon: string;
  /** Public, proxied path on the portal origin (e.g. `/tools/grafana`). */
  path: string;
  /** Safe to embed in an iframe tile. */
  embeddable: boolean;
  /** Expected to share the platform's OIDC session. */
  sso: boolean;
  /** `tile` = advertise in the UI; `hidden` = proxied but not shown. */
  display: "tile" | "hidden";
  /** Permissions gating this module in the portal (proxy enforces server-side). */
  requiresPermissions: string[];
}

/**
 * Fetch the federated module catalog. Client-side (the endpoint requires a
 * Bearer token). Never throws — returns `[]` on any failure so the UI degrades
 * to an empty catalog rather than erroring. `display: "hidden"` modules are
 * filtered out; the portal only surfaces advertised tiles.
 */
export async function fetchFederatedModules(token: string | null): Promise<FederatedTool[]> {
  try {
    const res = await fetch(`${API_BASE}/federation/modules`, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as FederatedTool[];
    if (!Array.isArray(data)) return [];
    return data.filter((m) => m.display !== "hidden");
  } catch {
    return [];
  }
}

/** True when the caller holds every permission required by a module (per `lib/permissions`). */
export function canOpenModule(
  modulePermissions: readonly string[],
  heldPermissions: readonly string[],
): boolean {
  if (modulePermissions.length === 0) return true;
  return modulePermissions.every((req) =>
    heldPermissions.some((h) => {
      if (h === req) return true;
      if (h === "platform:admin") return true;
      if (h.endsWith(":*")) return req.startsWith(h.slice(0, -1));
      return false;
    }),
  );
}
