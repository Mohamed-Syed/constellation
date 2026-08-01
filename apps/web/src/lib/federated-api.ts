import { readFileSync } from "node:fs";
import path from "node:path";

import type { FederatedCatalog, FederatedTool } from "./federated-tools";
import { parseModulesYaml } from "./federated-tools";

/**
 * Where to look for the federated `modules.yaml` catalog, in priority order:
 *   1. `NEXT_PUBLIC_FEDERATED_MODULES_URL` — an absolute raw-YAML URL (e.g. an
 *      SSO overlay / config server). Checked first so deployments can inject
 *      their own catalog without rebuilding the portal.
 *   2. `apps/web/public/modules.yaml` — a file committed with the repo as a
 *      local default. This function is only ever called from Server Components,
 *      so we read it directly from the filesystem (a relative `fetch()` would not
 *      resolve server-side). Degrades to an empty catalog if the file is absent.
 *
 * Both are best-effort: any failure degrades to an empty catalog (`source:
 * "none"`) so the portal never breaks because federation isn't configured yet.
 */
const REMOTE_URL = process.env.NEXT_PUBLIC_FEDERATED_MODULES_URL || "";
const LOCAL_PATH = path.join(process.cwd(), "public", "modules.yaml");

async function fetchRemoteYaml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function readLocalYaml(): string | null {
  try {
    return readFileSync(LOCAL_PATH, "utf8");
  } catch {
    return null;
  }
}

/**
 * Resolve the federated tool catalog. Never throws — returns an empty catalog
 * (with `source: "none"`) if nothing is configured or reachable.
 */
export async function getFederatedTools(): Promise<FederatedCatalog> {
  // 1. Remote override.
  if (REMOTE_URL) {
    const text = await fetchRemoteYaml(REMOTE_URL);
    if (text) {
      const { tools, note } = parseModulesYaml(text);
      sortCatalog(tools);
      return { tools, source: "remote", note };
    }
  }
  // 2. Local default file (read from disk — Server Component context).
  const local = readLocalYaml();
  if (local) {
    const { tools, note } = parseModulesYaml(local);
    sortCatalog(tools);
    return { tools, source: "local", note };
  }
  // 3. Nothing configured.
  return { tools: [], source: "none" };
}

function sortCatalog(tools: FederatedTool[]): void {
  // Group by category (undefined sorts first), then by status rank, then name.
  tools.sort((a, b) => {
    if ((a.category ?? "") < (b.category ?? "")) return -1;
    if ((a.category ?? "") > (b.category ?? "")) return 1;
    const rank = statusRank(a.status) - statusRank(b.status);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });
}

function statusRank(s: FederatedTool["status"]): number {
  return { live: 0, provisioning: 1, planned: 2, unknown: 3 }[s];
}
