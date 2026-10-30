import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiUrl } from "@/features/auth/server-api-base";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
  readRemember,
  clearAuthCookies,
} from "@/features/auth/cookies";
import type { RefreshResponse } from "@/features/auth/types";

/**
 * Server-side passthrough for GET /auth/me, reading the access token from its
 * httpOnly cookie (the browser has no other way to attach it to this call).
 * Used by the auth context (AuthProvider) to hydrate the current user on
 * load, and by the login page to detect an already-valid session.
 *
 * Does the same transparent refresh-and-retry as the `/api/v1/[...path]`
 * proxy: the access token expires every JWT_ACCESS_TTL (default 15m,
 * AUTH_RBAC.md §4/§7), which is routine mid-session, NOT a sign the user is
 * logged out. Without this, every AuthProvider mount after the access token
 * expired (a reload, a new tab, coming back after 15+ idle minutes) would
 * 401 here even though the refresh token is still perfectly valid — dropping
 * the signed-in user back to "logged out" in the UI for no real reason.
 */
export async function GET() {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!accessToken) {
    return tryRefresh(jar);
  }

  const upstream = await fetch(apiUrl("/auth/me"), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (upstream.status === 401) {
    return tryRefresh(jar);
  }

  const data = await upstream.json().catch(() => ({}));
  return NextResponse.json(data, { status: upstream.status });
}

async function tryRefresh(jar: Awaited<ReturnType<typeof cookies>>) {
  const refreshToken = jar.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const refreshRes = await fetch(apiUrl("/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });

  if (!refreshRes.ok) {
    // Refresh token itself is dead (expired, or a reuse-detected revoke of
    // the whole session family) — this really is "logged out". Clear the
    // stale cookies so nothing downstream keeps treating this browser as
    // authenticated.
    const res = NextResponse.json({ message: "Not authenticated" }, { status: 401 });
    clearAuthCookies(res);
    return res;
  }

  const data = (await refreshRes.json()) as RefreshResponse;
  const res = NextResponse.json(data.user);
  setAuthCookies(
    res,
    { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn },
    // Preserve the sign-in choice; this silent refresh must not change it.
    readRemember(jar),
  );
  return res;
}
