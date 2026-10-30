import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiUrl } from "@/features/auth/server-api-base";
import { setAuthCookies, clearAuthCookies, readRemember, REFRESH_TOKEN_COOKIE } from "@/features/auth/cookies";
import type { RefreshResponse } from "@/features/auth/types";

/**
 * Rotates the token pair (AUTH_RBAC.md §4: refresh tokens rotate on every
 * use, and re-presenting an already-revoked one revokes the whole session
 * family). Reads the refresh token from its own httpOnly cookie — never from
 * the request body — so the browser-side axios client only has to call this
 * route with no payload on a 401.
 */
export async function POST() {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const upstream = await fetch(apiUrl("/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });

  const data = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    const res = NextResponse.json(data, { status: upstream.status });
    // The old refresh token is dead either way (rotated or the whole family
    // revoked as a compromise signal) — drop the stale cookies so middleware
    // stops treating the browser as authenticated.
    clearAuthCookies(res);
    return res;
  }

  const { accessToken, refreshToken: newRefreshToken, expiresIn, user } = data as RefreshResponse;
  const res = NextResponse.json({ user });
  // Carry the sign-in choice across the rotation — a refresh must never
  // promote an unticked session into a persistent one.
  setAuthCookies(res, { accessToken, refreshToken: newRefreshToken, expiresIn }, readRemember(jar));
  return res;
}
