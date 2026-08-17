"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

import type { NavGroups } from "@/lib/nav";
import { filterNavForPermissions } from "@/lib/nav";
import { useAuth } from "@/components/auth/auth-provider";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { IdentityBanner } from "./identity-banner";

/** Routes reachable without an authenticated session. */
const PUBLIC_ROUTES = new Set(["/login"]);

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <div
        role="status"
        aria-label="Loading"
        className="size-6 animate-spin rounded-full border-2 border-neutral-300 border-t-accent dark:border-neutral-700"
      />
    </div>
  );
}

export function AppShell({
  navGroups,
  plugins,
  children,
}: {
  navGroups: NavGroups;
  plugins: { id: string; name: string }[];
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { status, permissions } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [commandOpen, setCommandOpen] = React.useState(false);

  const isPublicRoute = PUBLIC_ROUTES.has(pathname);

  // Gate: unauthenticated visitors get bounced to /login (carrying the page
  // they wanted so login can return them there), except on /login itself.
  React.useEffect(() => {
    if (isPublicRoute) return;
    if (status === "unauthenticated") {
      const search = pathname !== "/" ? `?redirect=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${search}`);
    }
  }, [status, isPublicRoute, pathname, router]);

  // Already signed in and sitting on /login (e.g. a restored session, or
  // hitting back) — send them into the portal instead of showing the form.
  React.useEffect(() => {
    if (pathname === "/login" && status === "authenticated") {
      router.replace("/");
    }
  }, [pathname, status, router]);

  if (isPublicRoute) {
    // No sidebar/topbar chrome on auth pages — but the identity banner still
    // shows: connecting to the WRONG API matters most at the login screen.
    return (
      <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-950">
        <IdentityBanner />
        {children}
      </div>
    );
  }

  if (status !== "authenticated") {
    // Covers both "checking" (verifying a stored token) and
    // "unauthenticated" (the redirect effect above is in flight) — render a
    // neutral loading state instead of the protected shell so gated
    // content/nav never flashes before the redirect lands.
    return <FullPageSpinner />;
  }

  const visibleNavGroups = filterNavForPermissions(navGroups, permissions);

  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <IdentityBanner />
      <Sidebar navGroups={visibleNavGroups} mobileOpen={mobileNavOpen} onMobileOpenChange={setMobileNavOpen} />
      <div className="flex min-h-dvh flex-col md:pl-64">
        <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} onOpenCommandPalette={() => setCommandOpen(true)} />
        <main className="flex-1">{children}</main>
      </div>
      <CommandPalette navGroups={visibleNavGroups} plugins={plugins} open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}
