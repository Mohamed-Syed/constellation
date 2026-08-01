"use client";

import * as React from "react";

import type { AuthUser } from "@/lib/types";
import { clearStoredToken, getStoredToken, setStoredToken } from "@/lib/auth-storage";
import { fetchMe, login as loginRequest, logoutRequest, type LoginOutcome } from "@/lib/auth-api";

/**
 * - "checking": initial mount only — verifying a stored token (or finding
 *   none). Nothing about the shell should render yet (see `AppShell`).
 * - "authenticated": a verified user + permission set is available.
 * - "unauthenticated": no token, a rejected token, or a token we couldn't
 *   verify because the API is unreachable. We fail CLOSED on "unreachable"
 *   (rather than trusting a stale token) so the portal never shows gated
 *   content on an unverified identity — see the comment in the effect below.
 */
type AuthStatus = "checking" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Effective, flattened permission set from `GET /api/auth/me`. Empty until authenticated. */
  permissions: string[];
  /** The bearer token, for callers that need to attach `Authorization` themselves (e.g. plugin mutations). */
  token: string | null;
  /** True if the most recent auth check/attempt failed to reach the API at all (vs. a clean 401/503 rejection). */
  apiUnreachable: boolean;
  login: (email: string, password: string) => Promise<LoginOutcome>;
  logout: () => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Deliberately starts identical on server and client (no token is known
  // during SSR — see lib/auth-storage.ts) so hydration never mismatches; the
  // stored token is only ever read client-side, in the effect below.
  const [status, setStatus] = React.useState<AuthStatus>("checking");
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [permissions, setPermissions] = React.useState<string[]>([]);
  const [token, setToken] = React.useState<string | null>(null);
  const [apiUnreachable, setApiUnreachable] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    const stored = getStoredToken();
    if (!stored) {
      setStatus("unauthenticated");
      return;
    }
    void fetchMe(stored).then((result) => {
      if (!active) return;
      if (result.ok) {
        setToken(stored);
        setUser({ id: result.me.id, email: result.me.email, roles: result.me.roles });
        setPermissions(result.me.permissions);
        setApiUnreachable(false);
        setStatus("authenticated");
      } else if (result.reason === "unauthorized") {
        clearStoredToken();
        setStatus("unauthenticated");
      } else {
        // API unreachable / unexpected error: we can't verify this token
        // right now. Fail closed to "unauthenticated" (the portal sends the
        // user to /login) rather than trusting a stale, unverified session —
        // but keep the token in storage so a retry once the API is back
        // succeeds without re-entering credentials, and flag
        // `apiUnreachable` so the UI can explain why instead of implying
        // bad credentials.
        setApiUnreachable(result.reason === "unreachable");
        setStatus("unauthenticated");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const login = React.useCallback(async (email: string, password: string): Promise<LoginOutcome> => {
    const result = await loginRequest(email, password);
    if (result.ok) {
      setStoredToken(result.accessToken);
      setToken(result.accessToken);
      setUser(result.user);
      setApiUnreachable(false);
      // The login response doesn't include permissions (see the shared
      // contract) — fetch them immediately via /me so nav/action gating is
      // correct right away instead of waiting for the next poll.
      const me = await fetchMe(result.accessToken);
      setPermissions(me.ok ? me.me.permissions : []);
      setStatus("authenticated");
    } else {
      setApiUnreachable(result.reason === "unreachable");
    }
    return result;
  }, []);

  const logout = React.useCallback(() => {
    const current = token ?? getStoredToken();
    if (current) void logoutRequest(current); // best-effort; stateless server-side
    clearStoredToken();
    setToken(null);
    setUser(null);
    setPermissions([]);
    setApiUnreachable(false);
    setStatus("unauthenticated");
  }, [token]);

  const value = React.useMemo<AuthContextValue>(
    () => ({ status, user, permissions, token, apiUnreachable, login, logout }),
    [status, user, permissions, token, apiUnreachable, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
