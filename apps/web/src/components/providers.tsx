"use client";

import * as React from "react";
import { Toaster } from "sonner";

import { ThemeProvider, useTheme } from "@/components/theme/theme-provider";
import { AuthProvider } from "@/components/auth/auth-provider";
import { SessionGuard } from "@/components/shell/session-guard";

/**
 * Theme-aware toast host (pick-ui-library: sonner for toasts). Must live inside
 * the ThemeProvider so it follows the current theme; rendered once at the root.
 */
function ToastHost() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      toastOptions={{
        duration: 4000,
        className: "rounded-xl border border-neutral-200/70 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-900",
      }}
    />
  );
}

/** Client-side context providers for the whole app. Keep it a thin composition root. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SessionGuard>
          {children}
          <ToastHost />
        </SessionGuard>
      </AuthProvider>
    </ThemeProvider>
  );
}
