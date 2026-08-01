"use client";

import * as React from "react";

import { ThemeProvider } from "@/components/theme/theme-provider";
import { AuthProvider } from "@/components/auth/auth-provider";
import { SessionGuard } from "@/components/shell/session-guard";

/** Client-side context providers for the whole app. Keep it a thin composition root. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SessionGuard>{children}</SessionGuard>
      </AuthProvider>
    </ThemeProvider>
  );
}
