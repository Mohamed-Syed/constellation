import type { Metadata, Viewport } from "next";
import "./globals.css";

import { getPlugins } from "@/lib/api";
import { buildNavGroups } from "@/lib/nav";
import { ThemeScript } from "@/components/theme/theme-script";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";

export const metadata: Metadata = {
  title: {
    default: "Constellation",
    template: "%s · Constellation",
  },
  description: "Enterprise plugin platform — the single pane of glass over every module.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Sidebar + command palette are data-driven from every loaded plugin's
  // manifest `navigation`. Fetched once here so every route shares it;
  // getPlugins() degrades to [] if the core API is down or empty.
  const plugins = await getPlugins();
  const navGroups = buildNavGroups(plugins);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <Providers>
          <AppShell navGroups={navGroups} plugins={plugins.map((p) => ({ id: p.id, name: p.name }))}>
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
