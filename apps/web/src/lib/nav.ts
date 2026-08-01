import type { PluginSummary } from "./types";

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
