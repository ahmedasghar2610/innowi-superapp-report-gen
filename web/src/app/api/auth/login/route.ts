import { NextResponse, type NextRequest } from "next/server";
import { apiUrl } from "@/features/auth/server-api-base";
import { setAuthCookies } from "@/features/auth/cookies";
import type { LoginPayload, LoginResponse } from "@/features/auth/types";

/**
 * Proxies POST /auth/login to the backend and, on success, stores the token
 * pair as httpOnly cookies instead of returning them to the browser — the
 * client never sees raw tokens (XSS can't read/exfiltrate them), and
 * middleware can still gate routes by reading the cookie.
 *
 * `rememberMe` is handled HERE and never forwarded: it decides whether the
 * cookies are persistent or session-scoped (see features/auth/cookies.ts),
 * and the backend's LoginDto sets `extra="forbid"`, so passing it through
 * would turn every sign-in into a 400.
 */
export async function POST(req: NextRequest) {
  let body: LoginPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid request body" }, { status: 400 });
  }

  const { rememberMe = false, email, password } = body;

  const upstream = await fetch(apiUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Only the two keys the backend accepts.
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  const data = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  const { accessToken, refreshToken, expiresIn, user } = data as LoginResponse;
  const res = NextResponse.json({ user });
  setAuthCookies(res, { accessToken, refreshToken, expiresIn }, rememberMe);
  return res;
}
