"use client";

import { useRouter } from "next/navigation";
import { LogOut, Menu, Search, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useAuth } from "@/components/auth/auth-provider";

interface TopbarProps {
  onOpenMobileNav: () => void;
  onOpenCommandPalette: () => void;
}

export function Topbar({ onOpenMobileNav, onOpenCommandPalette }: TopbarProps) {
  const router = useRouter();
  const { user, logout } = useAuth();

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white/80 px-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onOpenMobileNav} aria-label="Open navigation">
        <Menu className="size-5" />
      </Button>

      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm text-neutral-500 transition-colors hover:border-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-400 dark:hover:border-neutral-700"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">Search modules, pages, actions…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-neutral-300 bg-white px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 sm:inline dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
          Ctrl K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Account menu">
              <User className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[14rem]">
            <DropdownMenuLabel className="truncate">{user?.email ?? "Account"}</DropdownMenuLabel>
            {user?.roles && user.roles.length > 0 ? (
              <p className="truncate px-2 pb-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                {user.roles.join(", ")}
              </p>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogout} className="text-rose-600 focus:text-rose-600 dark:text-rose-400">
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
