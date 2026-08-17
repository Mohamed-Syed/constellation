"use client";

import * as React from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { fetchUnreadCount } from "@/lib/notifications";

const POLL_MS = 20000;

/**
 * Sidebar unread badge for the Notifications nav item (Phase 3.0).
 *
 * Polls `GET /api/notifications/unread-count` every 20s and on window focus
 * (visibilitychange), renders a small accent count chip — or nothing when
 * there are no unread notifications. Self-corrects: marking notifications
 * read on the /notifications page shows up here on the next poll.
 */
export function UnreadBadge() {
  const { token } = useAuth();
  const [count, setCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!token) return;
    let active = true;
    const load = async () => {
      const result = await fetchUnreadCount(token);
      if (active && result.state === "ok") setCount(result.data);
    };
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token]);

  if (count === null || count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread notification${count === 1 ? "" : "s"}`}
      className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent-fg"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
