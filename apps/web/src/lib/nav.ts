import type { PluginSummary } from "./types";
import { hasAnyPermission } from "./permissions";
import { BRAIN_READ_PERMISSION } from "./brain";

/** A single, portal-ready nav entry (core or plugin-contributed). */
export interface FlatNavItem {
  /** Stable key — `"core-*"` for platform items, `"<pluginId>:<navItemId>"` for plugin items. */
  id: string;
  label: string;
  href: string;
  /** Lucide icon name (see `lib/icons.ts`); resolved at render time. */
  icon?: string;
  order: number;
  /** Present for plugin-contributed items; omitted for core items. */
  pluginId?: string;
  /**
   * Permissions gating this item — the caller needs ANY one of them for the
   * item to show. Absent/empty means "always visible". UX only; the real
   * boundary is the API's RBAC guards.
   */
  requiresAnyPermission?: string[];
}

export interface NavGroups {
  /** Always-present core sections, pinned at the top. */
  platform: FlatNavItem[];
  /** Aggregated from every enabled-ish plugin's manifest `navigation`, sorted by `order`. */
  modules: FlatNavItem[];
  /** Always-present core sections, pinned at the bottom. */
  system: FlatNavItem[];
}

const CORE_PLATFORM: FlatNavItem[] = [
  { id: "core-dashboard", label: "Dashboard", href: "/", icon: "LayoutDashboard", order: 0 },
  { id: "core-modules", label: "Modules", href: "/modules", icon: "Blocks", order: 10 },
  { id: "core-workflows", label: "Workflows", href: "/workflows", icon: "Workflow", order: 15 },
  { id: "core-tools", label: "Tools", href: "/tools", icon: "Boxes", order: 20 },
  {
    // The platform's memory / knowledge graph (docs/BRAIN.md). Role-aware like
    // Admin: hidden unless the caller can read the brain.
    id: "core-brain",
    label: "Brain",
    href: "/brain",
    icon: "BrainCircuit",
    order: 30,
    requiresAnyPermission: [BRAIN_READ_PERMISSION],
  },
  {
    // The agentic task runtime (apps/api/src/core/engine). Visible to every
    // authenticated user — the engine's routes are JWT-guarded with no
    // granular permission enforced yet.
    id: "core-engine",
    label: "Engine",
    href: "/engine",
    icon: "Cpu",
    order: 40,
  },
  {
    // Phase 2.0 item 2.4 — live engine health dashboard. The endpoint is
    // public; the page renders queue depth, model availability, scheduler,
    // supervisor and alert trail.
    id: "core-health",
    label: "Health",
    href: "/health",
    icon: "Activity",
    order: 50,
  },
];

const CORE_SYSTEM: FlatNavItem[] = [
  { id: "core-settings", label: "Settings", href: "/settings", icon: "Settings", order: 900 },
  { id: "core-admin", label: "Admin", href: "/admin", icon: "ShieldCheck", order: 1000 },
];

/** Portal route a plugin nav item resolves to. The plugin's own routes mount under `/modules/<id>`. */
function pluginNavHref(pluginId: string, path: string): string {
  if (path === "/" || path === "") return `/modules/${pluginId}`;
  return `/modules/${pluginId}${path}`;
}

/**
 * Build the sidebar/command-palette nav data: fixed core items (Dashboard,
 * Modules, Settings, Admin) plus every plugin's `navigation` contributions,
 * aggregated and sorted by `order` (lower first). Plugins that failed to
 * load or declared no nav simply contribute nothing — never throws.
 */
export function buildNavGroups(plugins: PluginSummary[]): NavGroups {
  const modules: FlatNavItem[] = plugins
    .flatMap((plugin) =>
      (plugin.navigation ?? []).map(
        (item): FlatNavItem => ({
          id: `${plugin.id}:${item.id}`,
          label: item.label,
          href: pluginNavHref(plugin.id, item.path),
          icon: item.icon,
          order: item.order ?? 100,
          pluginId: plugin.id,
        }),
      ),
    )
    .sort((a, b) => a.order - b.order);

  return { platform: CORE_PLATFORM, modules, system: CORE_SYSTEM };
}

/** Flatten all groups into one ordered list — used by the command palette. */
export function flattenNavGroups(groups: NavGroups): FlatNavItem[] {
  return [...groups.platform, ...groups.modules, ...groups.system];
}

/** Permissions that unlock the "Admin" nav entry (either satisfies it — see MASTER_PLAN §8 P2 ROUND). */
const ADMIN_NAV_PERMISSIONS = ["core:plugin:manage", "platform:admin"];

/** True when the caller may see this nav item (no declared requirement ⇒ always). */
function navItemVisible(item: FlatNavItem, permissions: readonly string[]): boolean {
  const required = item.id === "core-admin" ? ADMIN_NAV_PERMISSIONS : item.requiresAnyPermission;
  if (!required || required.length === 0) return true;
  return hasAnyPermission(permissions, required);
}

/**
 * Role-aware nav (Orion P2 task 2, generalized for the BRAIN round): hide any
 * item whose `requiresAnyPermission` the caller doesn't satisfy. "Admin" keeps
 * its historical rule (`core:plugin:manage` OR `platform:admin`); "Brain"
 * requires `core:brain:read`. Applied client-side only (see `AppShell`) — this
 * is a UX nicety, not the security boundary; the pages' data and mutations are
 * guarded server-side.
 */
export function filterNavForPermissions(groups: NavGroups, permissions: readonly string[]): NavGroups {
  const keep = (item: FlatNavItem) => navItemVisible(item, permissions);
  return {
    platform: groups.platform.filter(keep),
    modules: groups.modules.filter(keep),
    system: groups.system.filter(keep),
  };
}
