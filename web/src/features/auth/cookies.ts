import type { NextResponse } from "next/server";

/**
 * httpOnly cookie names for the token pair. Kept in one place so the route
 * handlers, middleware, and any server component reading them agree.
 *
 * Access token cookie mirrors the JWT's own lifetime (JWT_ACCESS_TTL,
 * AUTH_RBAC.md §4/§7, default 15m) via `expiresIn` from the login/refresh
 * response. Refresh token cookie lives for JWT_REFRESH_TTL_DAYS (default 30d)
 * — we don't get that back from the API, so we mirror the documented default;
 * the server-side revocation is what actually matters for security, this only
 * bounds how long the browser holds onto it.
 *
 * ---------------------------------------------------------------------------
 * "Remember me"
 *
 * Both cookies are written one of two ways:
 *
 *   remember = true   maxAge is set, so the browser keeps them on disk and the
 *                     session survives closing the browser (up to 30 days).
 *   remember = false  maxAge is OMITTED, making them *session* cookies. The
 *                     browser drops them when it closes, so the next visit
 *                     lands on the sign-in screen.
 *
 * Only the sign-in form chooses. Every later write (refresh rotation, the
 * /api/v1 proxy's refresh-and-retry, /auth/me's silent refresh) has to
 * PRESERVE that choice rather than re-deciding it — otherwise a token
 * rotation twenty minutes in would silently upgrade an unticked session to a
 * persistent one. `REMEMBER_COOKIE` is how the choice survives: it is written
 * with the same persistence as the pair, so reading it back tells those paths
 * what the user asked for. Use `readRemember(jar)`.
 */
export const ACCESS_TOKEN_COOKIE = "innowi_at";
export const REFRESH_TOKEN_COOKIE = "innowi_rt";
/** Records the sign-in "Remember me" choice so refreshes don't re-decide it. */
export const REMEMBER_COOKIE = "innowi_remember";
const REFRESH_TTL_DAYS = 30;

const isProd = process.env.NODE_ENV === "production";

/** The minimal reader shape shared by `cookies()` and `NextRequest.cookies`. */
type CookieJar = { get(name: string): { value: string } | undefined };

/**
 * Was this session signed in with "Remember me" ticked?
 *
 * Defaults to `false` when the marker is absent — a session predating this
 * feature, or a tampered jar, is treated as the safer of the two.
 */
export function readRemember(jar: CookieJar): boolean {
  return jar.get(REMEMBER_COOKIE)?.value === "1";
}

export function setAuthCookies(
  res: NextResponse,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number },
  remember = false,
) {
  const base = {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
  };

  // Spreading a `maxAge` in only when remembering is deliberate: passing
  // `maxAge: undefined` is NOT the same as leaving it out for a session
  // cookie, and an explicit 0 would delete the cookie outright.
  res.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...base,
    ...(remember ? { maxAge: tokens.expiresIn } : {}),
  });

  res.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...base,
    ...(remember ? { maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 } : {}),
  });

  // Same persistence as the pair it describes, so it can never outlive them
  // and claim "remembered" for a session that is already gone.
  res.cookies.set(REMEMBER_COOKIE, remember ? "1" : "0", {
    ...base,
    ...(remember ? { maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 } : {}),
  });
}

export function clearAuthCookies(res: NextResponse) {
  // Deletion matches on name + path, so the path has to agree with the write.
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, REMEMBER_COOKIE]) {
    res.cookies.set(name, "", {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}
