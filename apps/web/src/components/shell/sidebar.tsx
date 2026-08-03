"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { resolveIcon } from "@/lib/icons";
import type { FlatNavItem, NavGroups } from "@/lib/nav";

interface SidebarProps {
  navGroups: NavGroups;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active, onNavigate }: { item: FlatNavItem; active: boolean; onNavigate: () => void }) {
  const Icon = resolveIcon(item.icon);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950",
        active
          ? "bg-accent/10 text-accent"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300")} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function NavSection({
  title,
  items,
  pathname,
  onNavigate,
  emptyLabel,
}: {
  title?: string;
  items: FlatNavItem[];
  pathname: string;
  onNavigate: () => void;
  emptyLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {title ? (
        <h3 className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          {title}
        </h3>
      ) : null}
      {items.length === 0 && emptyLabel ? (
        <p className="px-3 py-1 text-xs text-neutral-400 dark:text-neutral-500">{emptyLabel}</p>
      ) : (
        items.map((item) => (
          <NavLink key={item.id} item={item} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
        ))
      )}
    </div>
  );
}

export function Sidebar({ navGroups, mobileOpen, onMobileOpenChange }: SidebarProps) {
  const pathname = usePathname();
  const closeMobile = () => onMobileOpenChange(false);

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-neutral-200/80 px-4 dark:border-white/[0.06]">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-fg shadow-[0_1px_2px_rgba(109,94,252,0.4)]">
          <Sparkles className="size-4" />
        </span>
        <span className="font-semibold tracking-tight">Constellation</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
        <NavSection items={navGroups.platform} pathname={pathname} onNavigate={closeMobile} />
        <NavSection
          title="Modules"
          items={navGroups.modules}
          pathname={pathname}
          onNavigate={closeMobile}
          emptyLabel="No plugin modules installed yet"
        />
        <NavSection title="System" items={navGroups.system} pathname={pathname} onNavigate={closeMobile} />
      </nav>
      <div className="shrink-0 border-t border-neutral-200/80 px-4 py-3 text-xs text-neutral-400 dark:border-white/[0.06] dark:text-neutral-500">
        Constellation Platform · v0.1.0
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: persistent sidebar */}
      <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:w-64 md:flex-col md:border-r md:border-neutral-200/80 md:bg-white/85 md:backdrop-blur dark:md:border-white/[0.06] dark:md:bg-neutral-950/70">
        {content}
      </aside>

      {/* Mobile: off-canvas drawer */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity md:hidden",
          mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden="true"
        onClick={closeMobile}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-neutral-200 bg-white transition-transform duration-200 ease-out md:hidden",
          "dark:border-neutral-800 dark:bg-neutral-900",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Primary navigation"
      >
        {content}
      </aside>
    </>
  );
}
