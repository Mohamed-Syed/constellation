"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

/**
 * Session keeper (Orion P4 — session/login polish).
 *
 * While a session is active, this quietly verifies the token against
 * `GET /api/auth/me` on an interval. Two failure modes:
 *   - 401/403: the session expired or was revoked → log the user out and send
 *     them to /login (carrying the page they were on) so they don't stare at a
 *     silently-broken portal.
 *   - unreachable: the API is down → show a non-blocking banner (the portal
 *     already degrades its data), but don't force a logout (a restored API
 *     should bring the session back without re-auth).
 *
 * This is defense-in-depth on top of the gating in `AppShell`; it never throws
 * and never blocks render.
 */
export function SessionGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status, token, logout, setApiUnreachable } = useAuth();
  const [unreachable, setUnreachable] = React.useState(false);

  React.useEffect(() => {
    if (status !== "authenticated" || !token) {
      setUnreachable(false);
      return;
    }

    let active = true;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!active) return;
        if (res.status === 401 || res.status === 403) {
          // Session no longer valid — bounce to login.
          logout();
          const here = window.location.pathname;
          router.replace(here === "/" ? "/login" : `/login?redirect=${encodeURIComponent(here)}`);
          return;
        }
        setUnreachable(false);
        setApiUnreachable(false);
      } catch {
        if (!active) return;
        setUnreachable(true);
        setApiUnreachable(true);
      }
    };

    void check();
    const id = setInterval(check, 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [status, token, router, logout, setApiUnreachable]);

  return (
    <>
      {unreachable ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-700 dark:text-amber-300"
        >
          <WifiOff className="size-3.5 shrink-0" />
          Connection to the Constellation API was lost. Data may be out of date — we&apos;ll reconnect automatically.
        </div>
      ) : null}
      {children}
    </>
  );
}
