"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Boxes, Moon, RefreshCw, Sun } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { resolveIcon } from "@/lib/icons";
import type { NavGroups } from "@/lib/nav";
import { useTheme } from "@/components/theme/theme-provider";

interface CommandPaletteProps {
  navGroups: NavGroups;
  plugins: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ navGroups, plugins, open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const go = React.useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} label="Command palette">
      <CommandInput placeholder="Search modules, pages, actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Platform">
          {navGroups.platform.map((item) => {
            const Icon = resolveIcon(item.icon);
            return (
              <CommandItem key={item.id} value={item.label} onSelect={() => go(item.href)}>
                <Icon className="size-4 text-neutral-500 dark:text-neutral-400" />
                {item.label}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {navGroups.modules.length > 0 ? (
          <CommandGroup heading="Modules">
            {navGroups.modules.map((item) => {
              const Icon = resolveIcon(item.icon);
              return (
                <CommandItem key={item.id} value={`${item.label} ${item.pluginId ?? ""}`} onSelect={() => go(item.href)}>
                  <Icon className="size-4 text-neutral-500 dark:text-neutral-400" />
                  {item.label}
                </CommandItem>
              );
            })}
            {/* OR2-4: jump straight to any plugin's detail page from ⌘K. */}
            {plugins.map((p) => (
              <CommandItem
                key={`detail-${p.id}`}
                value={`open ${p.name} ${p.id} overview module detail`}
                keywords={[p.id, "detail", "overview", "module"]}
                onSelect={() => go(`/modules/${p.id}`)}
              >
                <Boxes className="size-4 text-neutral-500 dark:text-neutral-400" />
                {p.name} · overview
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <CommandGroup heading="System">
          {navGroups.system.map((item) => {
            const Icon = resolveIcon(item.icon);
            return (
              <CommandItem key={item.id} value={item.label} onSelect={() => go(item.href)}>
                <Icon className="size-4 text-neutral-500 dark:text-neutral-400" />
                {item.label}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick actions">
          <CommandItem
            value="toggle-theme"
            keywords={["dark", "light", "theme", "appearance"]}
            onSelect={() => {
              toggleTheme();
              onOpenChange(false);
            }}
          >
            {theme === "dark" ? (
              <Sun className="size-4 text-neutral-500 dark:text-neutral-400" />
            ) : (
              <Moon className="size-4 text-neutral-500 dark:text-neutral-400" />
            )}
            {theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          </CommandItem>
          <CommandItem
            value="refresh-modules"
            keywords={["reload", "plugins", "sync"]}
            onSelect={() => {
              onOpenChange(false);
              router.refresh();
            }}
          >
            <RefreshCw className="size-4 text-neutral-500 dark:text-neutral-400" />
            Refresh module data
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <div className="flex items-center justify-end gap-1 border-t border-neutral-200 px-3 py-2 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
        <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono dark:border-neutral-700 dark:bg-neutral-800">
          Ctrl/⌘
        </kbd>
        <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono dark:border-neutral-700 dark:bg-neutral-800">
          K
        </kbd>
        <span>to toggle</span>
      </div>
    </CommandDialog>
  );
}
