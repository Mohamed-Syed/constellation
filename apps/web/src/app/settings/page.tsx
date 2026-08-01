import type { Metadata } from "next";
import { Bell, Palette, Plug } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-2 text-neutral-500 dark:text-neutral-400">
          Platform preferences. Per-plugin settings (each manifest's `settings` array) land here once the
          settings service ships (roadmap A2/P2).
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Palette className="size-4" />
            </span>
            <div className="flex-1">
              <CardTitle className="text-base">Appearance</CardTitle>
              <CardDescription>Switch between light and dark, or follow your system.</CardDescription>
            </div>
            <ThemeToggle />
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-400 dark:bg-neutral-800">
              <Bell className="size-4" />
            </span>
            <div>
              <CardTitle className="text-base text-neutral-500 dark:text-neutral-400">Notifications</CardTitle>
              <CardDescription>Coming with the notification center (core backlog, §6).</CardDescription>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-400 dark:bg-neutral-800">
              <Plug className="size-4" />
            </span>
            <div>
              <CardTitle className="text-base text-neutral-500 dark:text-neutral-400">Plugin settings</CardTitle>
              <CardDescription>
                Each plugin can declare a `settings` panel in its manifest — surfaced here once the settings
                service (A2) is wired.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
