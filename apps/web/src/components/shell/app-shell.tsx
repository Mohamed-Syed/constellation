"use client";

import * as React from "react";

import type { NavGroups } from "@/lib/nav";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";

export function AppShell({
  navGroups,
  plugins,
  children,
}: {
  navGroups: NavGroups;
  plugins: { id: string; name: string }[];
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [commandOpen, setCommandOpen] = React.useState(false);

  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <Sidebar navGroups={navGroups} mobileOpen={mobileNavOpen} onMobileOpenChange={setMobileNavOpen} />
      <div className="flex min-h-dvh flex-col md:pl-64">
        <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} onOpenCommandPalette={() => setCommandOpen(true)} />
        <main className="flex-1">{children}</main>
      </div>
      <CommandPalette navGroups={navGroups} plugins={plugins} open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}
