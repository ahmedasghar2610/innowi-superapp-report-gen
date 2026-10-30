import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { apiUrl, apiOrigin } from "@/features/auth/server-api-base";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
  readRemember,
  clearAuthCookies,
} from "@/features/auth/cookies";
import type { RefreshResponse } from "@/features/auth/types";

/**
 * Same-origin proxy for every `/api/v1/*` call the browser makes (this is
 * what `NEXT_PUBLIC_API_BASE_URL=/api/v1` in the axios client hits — see
 * lib/constants.ts and lib/api/client.ts). Replaces the old bare
 * `rewrites()` passthrough in next.config.ts: a rewrite can forward a
 * request but can't attach a header, and the access token is an httpOnly
 * cookie the browser-side axios client can never read directly. So this
 * route reads the cookie server-side, attaches `Authorization: Bearer …`,
 * and forwards to the real API.
 *
 * It also makes token refresh transparent to every existing resource module:
 * on a 401 from the backend, it attempts ONE `/auth/refresh` (rotating the
 * pair per AUTH_RBAC.md §4) and retries the original request with the new
 * access token. If that also fails, the auth cookies are cleared and the
 * original 401 is returned — the axios response interceptor (lib/api/client.ts)
 * then redirects to /login.
 */

// A streamed assistant answer keeps this function open while it is written (the API stops
// starting new lookups after ~150 s), and on Vercel "Sync now" (GBP / Ads / SEO) and menu
// extraction run inside the API request (up to JOBS_TIME_BUDGET_S, 600 s by default), so the
// proxy must wait as long as the API function may run (api/vercel.json: 800 s).
export const maxDuration = 800;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "host",
  "content-encoding",
]);

async function proxy(req: NextRequest, path: string[]) {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_TOKEN_COOKIE)?.value;

  const targetPath = "/" + path.join("/");
  const search = req.nextUrl.search;
  const target = `${apiOrigin()}/api/v1${targetPath}${search}`;

  const method = req.method;
  const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";
  // Bytes, not text: a multipart upload (Step 10) is binary, and `req.text()`
  // would re-encode it as UTF-8 and corrupt every non-text file. The incoming
  // Content-Type (with its multipart boundary) is forwarded verbatim.
  const bodyBytes = hasBody ? await req.arrayBuffer() : undefined;

  async function send(token: string | undefined) {
    const headers = new Headers();
    headers.set("Content-Type", req.headers.get("content-type") ?? "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    // The Screaming Frog crawler helper (a PC, not a browser) signs in with its own key.
    for (const [k, v] of req.headers) if (k.toLowerCase().startsWith("x-crawler-") || k.toLowerCase() === "x-crawl-duration") headers.set(k, v);
    return fetch(target, {
      method,
      headers,
      body: bodyBytes,
      cache: "no-store",
      // If the browser goes away (e.g. Stop on a streamed answer), stop the upstream call too.
      signal: req.signal,
    });
  }

  // With "Remember me" the access-token cookie carries a maxAge equal to the
  // token's own lifetime, so the browser DELETES it the moment it expires —
  // the cookie is simply absent, not stale. The old guard here only refreshed
  // when an access token was present, so every call made more than 15 minutes
  // after the last rotation went upstream with no Authorization header, got a
  // 401, and was bounced to /login by the axios interceptor — where
  // /api/auth/me (which does refresh on a missing cookie) immediately signed
  // the person back in. That was the "fake logout". A missing access cookie
  // with a refresh cookie present is a routine expiry: refresh first, then send.
  const refreshToken = jar.get(REFRESH_TOKEN_COOKIE)?.value;
  let upstream: Response;
  if (!accessToken && refreshToken) {
    upstream = new Response(null, { status: 401 });
  } else {
    upstream = await send(accessToken);
  }

  // Transparent refresh-and-retry on an expired, invalid or missing access token.
  if (upstream.status === 401) {
    if (refreshToken) {
      const refreshRes = await fetch(apiUrl("/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });

      if (refreshRes.ok) {
        const data = (await refreshRes.json()) as RefreshResponse;
        upstream = await send(data.accessToken);

        const res = new NextResponse(isEventStream(upstream) ? upstream.body : upstream.status === 204 ? null : await upstream.arrayBuffer(), {
          status: upstream.status,
          headers: passthroughHeaders(upstream),
        });
        setAuthCookies(
          res,
          { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn },
          // Preserve the sign-in choice across the transparent rotation.
          readRemember(jar),
        );
        return res;
      }

      // Refresh token itself is dead (expired, or a reuse-detected revoke of
      // the whole session family) — the browser can no longer be treated as
      // authenticated for this request. `upstream` is the API's own 401 (its
      // error envelope) or, when no access cookie was sent, the placeholder
      // above; either way answer 401 with a body the client can read.
      const body = (await upstream.text()) || JSON.stringify({ message: "Not authenticated" });
      const headers = passthroughHeaders(upstream);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      const res = new NextResponse(body, { status: 401, headers });
      clearAuthCookies(res);
      return res;
    }
  }

  // Server-sent events (the assistant's streamed answers) are passed through
  // as they arrive instead of being buffered, so text appears word by word.
  if (isEventStream(upstream)) {
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: passthroughHeaders(upstream),
    });
  }

  // A 204 (DELETE responses per API_REFERENCE.md §1) must not carry a body —
  // the Fetch API / undici throws constructing a Response otherwise. Bytes,
  // not text, so a streamed file download (Step 10) arrives intact with its
  // Content-Type / Content-Disposition passed through.
  return new NextResponse(upstream.status === 204 ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: passthroughHeaders(upstream),
  });
}

function isEventStream(upstream: Response): boolean {
  return (upstream.headers.get("content-type") ?? "").startsWith("text/event-stream") && upstream.body !== null;
}

function passthroughHeaders(upstream: Response): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
}

type RouteCtx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  return proxy(req, (await ctx.params).path);
}
