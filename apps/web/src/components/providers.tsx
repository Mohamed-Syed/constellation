"use client";

import * as React from "react";

import { ThemeProvider } from "@/components/theme/theme-provider";

/** Client-side context providers for the whole app. Keep it a thin composition root. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
