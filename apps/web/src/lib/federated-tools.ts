/**
 * Federated tool catalog — the P3 "portal federation" surface.
 *
 * Heavyweight tools (Grafana, Langflow, Open WebUI, Coolify, …) are NOT
 * bundled into the core. They're federated: the core (or a deployment overlay)
 * advertises them in a `modules.yaml` file, and the portal renders each as a
 * tile that opens the tool in a new tab via its SSO-proxied URL. SSO + reverse
 * proxy are a later P3 item (see MASTER_PLAN §7 / §8), so today the portal only
 * needs the *catalog* + tile UI; the `url` is opened directly when present.
 *
 * This module is the portal-side contract. It deliberately does NOT depend on a
 * backend endpoint that doesn't exist yet (no `GET /api/federated-tools` is
 * wired in `apps/api` as of this writing). Instead it reads a `modules.yaml`
 * that may be:
 *   - mounted at `${NEXT_PUBLIC_FEDERATED_MODULES_URL}` (a raw YAML URL), or
 *   - shipped in the repo at `apps/web/public/modules.yaml`.
 * If neither is reachable / valid, every consumer degrades to an empty catalog
 * rather than throwing — the portal shell always renders.
 *
 * The YAML shape is intentionally minimal and additive; the loader tolerates
 * missing/extra keys so an evolving `modules.yaml` can't crash the UI.
 */

export type FederatedToolStatus = "live" | "provisioning" | "planned" | "unknown";

export interface FederatedTool {
  /** Stable id, e.g. "grafana". */
  id: string;
  /** Display name, e.g. "Grafana". */
  name: string;
  /** Short description shown under the tile. */
  description: string;
  /** Lucide-style icon name (matches `lib/icons.ts`'s curated registry). */
  icon?: string;
  /** SSO/proxied URL the tile opens. May be absent if not wired yet. */
  url?: string;
  /** Lifecycle status; drives the tile's badge. Defaults to "unknown". */
  status: FederatedToolStatus;
  /** Sort/group key, e.g. "observability". Optional. */
  category?: string;
  /** True when `url` is present and the tool is ready to open. */
  openable: boolean;
}

export interface FederatedCatalog {
  tools: FederatedTool[];
  /** Where the catalog was sourced from (for the UI's "source" footnote). */
  source: "remote" | "local" | "none";
  /** Non-fatal note (e.g. parse warning), surfaced as a soft hint. */
  note?: string;
}

const STATUS_RANK: Record<FederatedToolStatus, number> = {
  live: 0,
  provisioning: 1,
  planned: 2,
  unknown: 3,
};

function normalizeStatus(raw: unknown): FederatedToolStatus {
  switch (String(raw ?? "").toLowerCase()) {
    case "live":
    case "ready":
    case "enabled":
    case "active":
      return "live";
    case "provisioning":
    case "deploying":
    case "pending":
      return "provisioning";
    case "planned":
    case "planned":
    case "roadmap":
      return "planned";
    default:
      return "unknown";
  }
}

function coerceTool(raw: Record<string, unknown>, index: number): FederatedTool | null {
  const id = typeof raw.id === "string" ? raw.id : typeof raw.name === "string" ? slug(raw.name) : `tool-${index}`;
  if (!id) return null;
  const url = typeof raw.url === "string" && raw.url.trim() ? raw.url.trim() : undefined;
  const status = normalizeStatus(raw.status);
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : id,
    description: typeof raw.description === "string" ? raw.description : "",
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    url,
    status,
    category: typeof raw.category === "string" ? raw.category : undefined,
    openable: Boolean(url) && (status === "live" || status === "unknown"),
  };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Dependency-free YAML parser scoped to the `modules.yaml` shape we expect.
 * We intentionally do NOT pull in js-yaml (it isn't installed, and the rules
 * forbid adding deps here) — instead we parse the small subset this catalog
 * uses: a top-level `tools:` list of `- key: value` mappings, 2-space
 * indented, with `|`/`>` block scalars treated as opaque strings. This is
 * enough for the documented contract and fails soft (returns what it could).
 *
 * If the input isn't YAML-shaped at all, we return an empty list rather than
 * throwing, so a misconfigured `modules.yaml` degrades instead of 500-ing.
 */
export function parseModulesYaml(text: string): { tools: FederatedTool[]; note?: string } {
  const lines = text.split(/\r?\n/);
  const tools: FederatedTool[] = [];
  let note: string | undefined;

  // Locate the `tools:` block.
  let i = 0;
  for (; i < lines.length; i++) {
    const m = (lines[i] ?? "").match(/^\s*tools\s*:\s*(#.*)?$/);
    if (m) {
      i++;
      break;
    }
  }
  if (i > lines.length) return { tools: [] };

  // Each top-level list item starts with `- ` (2-space base indentation).
  let current: Record<string, unknown> | null = null;
  let pendingKey: string | null = null;
  let blockBuffer: string[] | null = null;

  const flush = () => {
    if (current) {
      const t = coerceTool(current, tools.length);
      if (t) tools.push(t);
    }
    current = null;
  };

  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      if (blockBuffer) blockBuffer.push("");
      continue;
    }
    const indent = line.length - line.trimStart().length;

    // List item start at our base indent (2 spaces + "- ").
    if (indent <= 2 && line.trimStart().startsWith("- ")) {
      flush();
      current = {};
      pendingKey = null;
      blockBuffer = null;
      const rest = line.trimStart().slice(2);
      const kv = splitKey(rest);
      if (kv) {
        pendingKey = kv.key;
        if (kv.hasValue) current[kv.key] = kv.value;
        else pendingKey = kv.key;
      }
      continue;
    }

    // A deeper-indented line belongs to the current item.
    if (!current) continue;

    // Detect a block scalar start: `key: |`
    const blockStart = line.trimStart().match(/^([a-zA-Z0-9_]+)\s*:\s*[|>]-?\s*$/);
    if (blockStart && indent > 2) {
      pendingKey = blockStart[1] ?? null;
      blockBuffer = [];
      continue;
    }
    if (blockBuffer !== null && indent > 2) {
      blockBuffer.push(line.trim());
      continue;
    }
    if (blockBuffer !== null && (indent <= 2 || line.trim() === "")) {
      current[pendingKey ?? "value"] = blockBuffer.join("\n").trim();
      blockBuffer = null;
      pendingKey = null;
    }

    if (indent > 2) {
      const kv = splitKey(line.trimStart());
      if (kv) {
        current[kv.key] = kv.value;
        pendingKey = kv.key;
      }
    }
  }
  flush();

  if (tools.length === 0) {
    note = "No `tools:` entries were found in modules.yaml.";
  }
  return { tools, note };
}

function splitKey(line: string): { key: string; value: string; hasValue: boolean } | null {
  const idx = line.indexOf(":");
  if (idx === -1) return null;
  const key = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  if (!key) return null;
  if (value === "") return { key, value: "", hasValue: false };
  // Strip surrounding quotes if present.
  const unquoted = value.replace(/^["'](.*)["']$/, "$1");
  return { key, value: unquoted, hasValue: true };
}
