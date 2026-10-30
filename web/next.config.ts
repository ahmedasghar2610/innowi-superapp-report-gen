import type { NextConfig } from "next";

/**
 * The Merchant Profiling API is a separate NestJS service. Calling it directly
 * from the browser is a CROSS-ORIGIN request (the app runs on a different port),
 * which the browser blocks unless the API sends CORS headers — that shows up as
 * axios "Network Error" even though the same URL works in Postman.
 *
 * `/api/v1/*` is now handled by a Next.js route handler
 * (src/app/api/v1/[...path]/route.ts) rather than a bare `rewrites()` proxy:
 * the access token lives in an httpOnly cookie the browser can't attach
 * itself, so the same-origin request needs a server-side hop that reads the
 * cookie, sets `Authorization: Bearer …`, and forwards to the real API (that
 * route handler also does transparent refresh-on-401). It reads the same
 * `API_ORIGIN` env var this file used to.
 *
 * Point the frontend at the relative base with
 * `NEXT_PUBLIC_API_BASE_URL=/api/v1`, and set `API_ORIGIN` to where the API
 * actually runs (default http://localhost:3000).
 */

const isDev = process.env.NODE_ENV !== "production";

/**
 * Security response headers — ported from Final-MVP's `vercel.json` header
 * block and expressed here so they apply on any host, not only Vercel.
 *
 * The CSP is written for what this app actually loads: its own bundles,
 * Inter from Google Fonts (app/layout.tsx), images from the API / public site
 * template / merchants' own sites, and the Site Builder's same-origin preview
 * iframe (plus YouTube/Vimeo embeds the editor's video widget offers).
 * `'unsafe-inline'` on scripts is needed for the theme boot script in
 * layout.tsx and Next's own inline runtime; `'unsafe-eval'` only in dev
 * (React Refresh). Tighten with nonces once those move to next/script.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https:",
  `connect-src 'self'${isDev ? " ws: wss: http://localhost:* http://127.0.0.1:*" : ""}`,
  "frame-src 'self' https://www.youtube.com https://player.vimeo.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

/**
 * Cloned / studio previews render third-party HTML verbatim inside the
 * editor's iframe (src/features/site-builder/server/studio-preview.ts). They
 * need their original scripts, fonts, images and embeds to work, so they get
 * a permissive-but-not-empty policy: anything over https, no plugins, and
 * they may only ever be framed by this app.
 */
const previewContentSecurityPolicy = [
  "default-src 'self' https: http: data: blob: 'unsafe-inline' 'unsafe-eval'",
  "object-src 'none'",
  "frame-ancestors 'self'",
].join("; ");

const baseSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // microphone=(self): the assistant's voice input (features/assistant/voice.ts) needs the mic on
  // this site's own pages. Other sites embedded in a frame still can't use it.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework/version.
  poweredByHeader: false,
  // Keep browser source maps out of production bundles (Final-MVP:
  // GENERATE_SOURCEMAP=false).
  productionBrowserSourceMaps: false,
  // Website module's "Clone a Website" engine (src/features/site-builder)
  // uses Playwright (spawns/controls a real Chromium binary), cheerio (native
  // parsing internals) and jszip — these need to stay external to the server
  // bundle rather than be processed by webpack, the same way site-builder's
  // own next.config.mjs marks them. Ported verbatim from that config.
  serverExternalPackages: ["jszip", "cheerio", "playwright"],

  async headers() {
    return [
      {
        // Everything except the preview routes: strict policy, never framed.
        source: "/((?!api/clone/preview/).*)",
        headers: [
          ...baseSecurityHeaders,
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
      {
        // Preview documents: same base headers, framable by this app only.
        source: "/api/clone/preview/:path*",
        headers: [
          ...baseSecurityHeaders,
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: previewContentSecurityPolicy },
        ],
      },
      {
        // Auth and API proxy responses carry tokens/merchant data: no caching.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
