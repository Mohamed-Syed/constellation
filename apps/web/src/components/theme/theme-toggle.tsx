"use client";

import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="press-scale relative overflow-hidden"
    >
      {/* Cross-fade + rotate on theme switch (GPU-safe transform/opacity only). */}
      <Sun className="absolute size-4 rotate-90 scale-50 opacity-0 transition-all duration-200 ease-out dark:rotate-0 dark:scale-100 dark:opacity-100" />
      <Moon className="size-4 transition-all duration-200 ease-out dark:rotate-90 dark:scale-50 dark:opacity-0" />
    </Button>
  );
}
