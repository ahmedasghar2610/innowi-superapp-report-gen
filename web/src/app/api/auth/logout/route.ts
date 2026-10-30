import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiUrl } from "@/features/auth/server-api-base";
import { clearAuthCookies, REFRESH_TOKEN_COOKIE } from "@/features/auth/cookies";

/**
 * Revokes the current session server-side (POST /auth/logout,
 * AUTH_RBAC.md §4) and always clears the local cookies, even if the upstream
 * call fails (e.g. the refresh token was already revoked) — the user's intent
 * is to be signed out locally regardless.
 */
export async function POST() {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_TOKEN_COOKIE)?.value;

  if (refreshToken) {
    await fetch(apiUrl("/auth/logout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    }).catch(() => {
      /* best-effort — cookies are cleared below regardless */
    });
  }

  const res = NextResponse.json({ ok: true });
  clearAuthCookies(res);
  return res;
}
