"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Accessible tabs with roving-tabindex keyboard navigation (Left/Right/Home/End),
 * ARIA roles, and visible focus rings. Follows the existing portal primitives'
 * neutral palette and `accent` brand color. No close/open animation — tab
 * switching is a keyboard-heavy action (used hundreds of times), so per
 * design-engineering guidance it stays instant.
 */

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  idBase: string;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs subcomponents must be used within <Tabs>");
  return ctx;
}

interface TabsProps {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
}

function Tabs({ defaultValue, value, onValueChange, className, children }: TabsProps) {
  const [internal, setInternal] = React.useState(defaultValue);
  const current = value ?? internal;
  const idBase = React.useId();

  const setValue = React.useCallback(
    (next: string) => {
      if (value === undefined) setInternal(next);
      onValueChange?.(next);
    },
    [value, onValueChange],
  );

  return (
    <TabsContext.Provider value={{ value: current, setValue, idBase }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  className?: string;
  children: React.ReactNode;
  "aria-label": string;
}

function TabsList({ className, children, ...props }: TabsListProps) {
  const { setValue } = useTabs();

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const idx = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    let nextIdx = idx;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIdx = (idx + 1) % tabs.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIdx = (idx - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        nextIdx = 0;
        break;
      case "End":
        nextIdx = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = tabs[nextIdx];
    if (!next) return;
    setValue(next.getAttribute("data-tab-value") ?? "");
    next.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={props["aria-label"]}
      onKeyDown={onKeyDown}
      className={cn("flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800", className)}
    >
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  className?: string;
  children: React.ReactNode;
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ value, className, children }, ref) => {
    const { value: current, setValue, idBase } = useTabs();
    const selected = current === value;
    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        data-tab-value={value}
        id={`${idBase}-tab-${value}`}
        aria-selected={selected}
        aria-controls={`${idBase}-panel-${value}`}
        tabIndex={selected ? 0 : -1}
        onClick={() => setValue(value)}
        className={cn(
          "relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950",
          selected
            ? "border-accent text-accent"
            : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100",
          className,
        )}
      >
        {children}
      </button>
    );
  },
);
TabsTrigger.displayName = "TabsTrigger";

interface TabsContentProps {
  value: string;
  className?: string;
  children: React.ReactNode;
}

function TabsContent({ value, className, children }: TabsContentProps) {
  const { value: current, idBase } = useTabs();
  if (current !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${value}`}
      aria-labelledby={`${idBase}-tab-${value}`}
      tabIndex={0}
      className={cn(
        "pt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950",
        className,
      )}
    >
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
