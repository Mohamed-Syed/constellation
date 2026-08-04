/**
 * Phase 3.0 — notification center: portal-side client for the durable
 * platform event feed (`apps/api/src/core/notifications`).
 *
 * CONTRACT (read from the API source — notifications.controller.ts +
 * notification.service.ts):
 *   GET    /api/notifications             (Bearer) ?limit&kind&unread
 *                                            → { items, unreadCount }
 *   GET    /api/notifications/unread-count (Bearer) → { unreadCount }
 *   POST   /api/notifications/read-all     (Bearer) → { updated }
 *   POST   /api/notifications/:id/read     (Bearer) → { id, read }
 *   DELETE /api/notifications/:id          (Bearer) → { id, dismissed }
 *
 * The feed is written exclusively by platform events (engine alerts,
 * scheduler fires/errors); the portal only reads / marks-read / dismisses.
 * Same never-throw discipline as lib/engine.ts: every call returns a
 * discriminated result and the UI degrades gracefully.
 *
 * Also exposes the admin-only audit trail (`GET /api/audit`, requires
 * core:audit:read) — the notification center renders it as a second tab so
 * the accountable trail sits next to the event feed.
 */
import { API_BASE } from "./api-base";

export type NotificationSeverity = "info" | "success" | "warning" | "error";

export interface PlatformNotification {
  id: string;
  kind: string;
  severity: NotificationSeverity;
  title: string;
  message: string | null;
  refType: "task" | "schedule" | null;
  refId: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationListResult {
  items: PlatformNotification[];
  unreadCount: number;
}

/** One row from `GET /api/audit` (createdAt serialized to ISO by the API). */
export interface AuditEntry {
  id: string;
  pluginId: string;
  actorId: string | null;
  action: string;
  metadata: unknown;
  createdAt: string;
}

export type NotificationsResult<T> =
  | { state: "ok"; data: T }
  | { state: "forbidden"; message: string }
  | { state: "error"; message: string };

function authHeaders(token: string | null): HeadersInit | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

async function request<T>(
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<NotificationsResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      credentials: "include",
      headers: authHeaders(token),
      ...init,
    });
    if (res.status === 401 || res.status === 403) {
      return { state: "forbidden", message: `HTTP ${res.status}` };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { state: "ok", data: (await res.json()) as T };
  } catch (err) {
    return { state: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** GET /api/notifications — recent notifications, newest first, plus the total unread count. */
export function fetchNotifications(
  token: string | null,
  opts: { limit?: number; kind?: string; unread?: boolean } = {},
): Promise<NotificationsResult<NotificationListResult>> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.unread) params.set("unread", "true");
  const qs = params.toString();
  return request<NotificationListResult>(`/notifications${qs ? `?${qs}` : ""}`, token);
}

/** GET /api/notifications/unread-count — powers the sidebar badge. */
export async function fetchUnreadCount(token: string | null): Promise<NotificationsResult<number>> {
  const result = await request<{ unreadCount: number }>("/notifications/unread-count", token);
  return result.state === "ok" ? { state: "ok", data: result.data.unreadCount } : result;
}

/** POST /api/notifications/:id/read — mark one notification read. */
export function markNotificationRead(token: string | null, id: string): Promise<NotificationsResult<{ id: string; read: boolean }>> {
  return request<{ id: string; read: boolean }>(`/notifications/${encodeURIComponent(id)}/read`, token, { method: "POST" });
}

/** POST /api/notifications/read-all — mark every notification read. */
export function markAllNotificationsRead(token: string | null): Promise<NotificationsResult<{ updated: number }>> {
  return request<{ updated: number }>("/notifications/read-all", token, { method: "POST" });
}

/** DELETE /api/notifications/:id — dismiss (delete) one notification. */
export function dismissNotification(token: string | null, id: string): Promise<NotificationsResult<{ id: string; dismissed: boolean }>> {
  return request<{ id: string; dismissed: boolean }>(`/notifications/${encodeURIComponent(id)}`, token, { method: "DELETE" });
}

/** GET /api/audit — recent audit log entries (admin-only: core:audit:read). */
export function fetchAuditEntries(token: string | null, limit = 50): Promise<NotificationsResult<AuditEntry[]>> {
  return request<AuditEntry[]>(`/audit?limit=${limit}`, token);
}

/** A configured outbound notification channel (webhook family). */
export interface NotificationChannel {
  id: string;
  name: string;
  type: "webhook";
  url: string;
  format: "slack" | "discord" | "teams" | "generic";
  kinds: string[];
  enabled: boolean;
}

export type NotificationChannelInput = {
  id?: string;
  name: string;
  url: string;
  format: NotificationChannel["format"];
  kinds: string[];
  enabled: boolean;
};

/** GET /api/notifications/channels — configured outbound channels. */
export async function fetchNotificationChannels(token: string | null): Promise<NotificationsResult<NotificationChannel[]>> {
  const result = await request<{ channels: NotificationChannel[] }>("/notifications/channels", token);
  return result.state === "ok" ? { state: "ok", data: result.data.channels } : result;
}

/** POST /api/notifications/channels — create or update a channel. */
export function upsertNotificationChannel(
  token: string | null,
  input: NotificationChannelInput,
): Promise<NotificationsResult<{ channel: NotificationChannel }>> {
  return request<{ channel: NotificationChannel }>("/notifications/channels", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** DELETE /api/notifications/channels/:id — remove a channel. */
export function deleteNotificationChannel(token: string | null, id: string): Promise<NotificationsResult<{ id: string; removed: boolean }>> {
  return request<{ id: string; removed: boolean }>(`/notifications/channels/${encodeURIComponent(id)}`, token, { method: "DELETE" });
}

/** POST /api/notifications/channels/:id/test — deliver a test message. */
export function testNotificationChannel(
  token: string | null,
  id: string,
): Promise<NotificationsResult<{ ok: boolean; status?: number; error?: string }>> {
  return request<{ ok: boolean; status?: number; error?: string }>(`/notifications/channels/${encodeURIComponent(id)}/test`, token, {
    method: "POST",
  });
}
