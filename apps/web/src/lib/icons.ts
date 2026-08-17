import {
  type LucideIcon,
  Activity,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Blocks,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleDot,
  Cog,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  Globe,
  Home,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  LineChart,
  Menu,
  MessagesSquare,
  Moon,
  Package,
  PieChart,
  Plus,
  Puzzle,
  Radar,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Share2,
  Sun,
  Terminal,
  Users,
  Workflow,
  Wrench,
  X,
  XCircle,
} from "lucide-react";

/**
 * Curated registry a plugin's manifest `icon` string (e.g. `"Rocket"`) is
 * resolved against — matches Lucide's PascalCase export names. Kept as a
 * static map (rather than lucide-react's async `DynamicIcon`) so nav renders
 * synchronously with no client-side fetch/flicker or hydration gap.
 *
 * Not exhaustive: it covers the common "module/service" iconography a plugin
 * author is likely to reach for. Unknown names fall back to `DEFAULT_ICON`.
 */
const ICONS: Record<string, LucideIcon> = {
  Activity,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Blocks,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleDot,
  Cog,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  Globe,
  Home,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  LineChart,
  Menu,
  MessagesSquare,
  Moon,
  Package,
  PieChart,
  Plus,
  Puzzle,
  Radar,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Share2,
  Sun,
  Terminal,
  Users,
  Workflow,
  Wrench,
  X,
  XCircle,
};

/** Shown when a manifest names an icon we don't recognize, or names none. */
export const DEFAULT_ICON: LucideIcon = Puzzle;

/**
 * Normalize `kebab-case`, `snake_case`, `lower case`, or already-PascalCase
 * input to Lucide's PascalCase export name (`"sparkles"` / `"sparkles-icon"`
 * -> `"Sparkles"`). Plugin manifests aren't guaranteed to use PascalCase (the
 * bundled `hello-world` reference plugin ships `"sparkles"`), so the portal
 * must be tolerant of the common casings a plugin author would reach for.
 */
function toPascalCase(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

/** Resolve a manifest `icon` string to a component. Case/format-tolerant; falls back to `DEFAULT_ICON`. */
export function resolveIcon(name?: string): LucideIcon {
  if (!name) return DEFAULT_ICON;
  return ICONS[name] ?? ICONS[toPascalCase(name)] ?? DEFAULT_ICON;
}
