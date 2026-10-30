import { NextResponse, type NextRequest } from "next/server";
import { REFRESH_TOKEN_COOKIE } from "@/features/auth/cookies";

/**
 * Route guard. Runs before any page renders, so an unauthenticated visitor
 * never even gets the (app) shell's HTML — no client-side flash of protected
 * content before a redirect.
 *
 * We gate on the REFRESH token cookie, not the access token: the access
 * token is short-lived (JWT_ACCESS_TTL, default 15m — AUTH_RBAC.md §4/§7)
 * and expiring it is normal mid-session, handled transparently by the
 * `/api/v1/[...path]` proxy's refresh-and-retry. The refresh token
 * (default 30d) is the actual "is there a session at all" signal; if it's
 * missing, this middleware sends the user to /login. If it's present but the
 * backend has actually revoked/expired it, that's NOT something middleware
 * can know from a cookie alone — an API call will 401, the proxy's own
 * refresh attempt will fail too, and the axios client's response interceptor
 * sends the user to /login from there.
 *
 * IMPORTANT: middleware must never redirect FROM /login based on cookie
 * presence. Earlier this also bounced /login → / whenever the refresh-token
 * cookie merely existed, on the theory that "cookie present = signed in."
 * That's wrong the moment the cookie is stale (expired/revoked but not yet
 * cleared): a protected page 401s → axios sends the user to /login → this
 * redirect immediately bounces them back to / → the page 401s again → dead
 * loop, with literally no way to reach the sign-in form. Whether a session
 * is *actually* still valid is a question only the API can answer (it's
 * exactly what GET /auth/me is for) — that check now lives client-side in
 * LoginForm itself (features/auth/login-form.tsx, via useAuth() /
 * auth-context.tsx), where a real 401 can be told apart from a
 * merely-present cookie.
 */
// /invite: the accept-invitation page — the person has no account yet.
// /lead-action: the partner-lead e-mail buttons (token in the link, confirm before acting).
const PUBLIC_PATHS = ["/login", "/invite", "/lead-action"];
// /q/<token>: a restaurant's quote link (features/quotes/public) — no account at all.
const PUBLIC_PREFIXES = ["/q/"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Next internals, static assets, and this app's own auth/API route handlers
  // (which do their own auth and must stay reachable to log in / refresh /
  // log out in the first place).
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$/.test(pathname)
  );
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const hasSession = Boolean(req.cookies.get(REFRESH_TOKEN_COOKIE)?.value);
  if (!hasSession) {
    const loginUrl = new URL("/login", req.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
