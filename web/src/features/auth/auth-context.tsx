"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser } from "./types";
import { meRequest, logoutRequest } from "./auth-api";

interface AuthContextValue {
  /** `undefined` = still resolving on first load, `null` = signed out. */
  user: AuthUser | null | undefined;
  setUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Hydrates the current user via GET /auth/me (through our own /api/auth/me
 * route handler, which reads the httpOnly access-token cookie server-side —
 * see AUTH_RBAC.md §4). Middleware already keeps unauthenticated users off
 * (app) routes, so this is for *displaying* who's signed in (Topbar avatar)
 * and exposing logout, not for gating access.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null | undefined>(undefined);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    meRequest()
      .then((u) => {
        if (!cancelled) setUserState(u);
      })
      .catch(() => {
        if (!cancelled) setUserState(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setUser = useCallback((u: AuthUser) => setUserState(u), []);

  const logout = useCallback(async () => {
    await logoutRequest().catch(() => {
      /* cookies are cleared server-side regardless — see /api/auth/logout */
    });
    setUserState(null);
    router.replace("/login");
    router.refresh();
  }, [router]);

  const value = useMemo(() => ({ user, setUser, logout }), [user, setUser, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
