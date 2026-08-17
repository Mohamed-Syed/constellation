import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { getPlugins } from "@/lib/api";
import { buildNavGroups } from "@/lib/nav";
import { ThemeScript } from "@/components/theme/theme-script";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";

// Geist (Vercel's typeface, self-hosted via next/font — no CDN). The
// redesign-skill audit's #1 priority was a distinctive typeface over the
// system stack; Geist keeps the Linear-style technical tone, and Geist Mono
// gives the data-heavy numbers tabular figures (see tailwind.config.ts).
const geistSans = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <Providers>
          <AppShell navGroups={navGroups} plugins={plugins.map((p) => ({ id: p.id, name: p.name }))}>
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
