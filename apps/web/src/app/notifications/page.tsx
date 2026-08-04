"use client";

import { NotificationsView } from "@/components/notifications/notifications-view";

/**
 * `/notifications` — Phase 3.0 notification center: the durable platform
 * event feed (engine alerts + scheduler events) with an admin audit-log tab.
 *
 * Client-rendered: every `/api/notifications/*` route requires a Bearer token
 * that only exists browser-side (`lib/auth-storage.ts`), same shape as
 * `/engine` and `/workflows`.
 */
export default function NotificationsPage() {
  return <NotificationsView />;
}
