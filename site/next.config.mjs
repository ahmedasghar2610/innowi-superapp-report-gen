const isDev = process.env.NODE_ENV !== "production";

/**
 * Security response headers — ported from Final-MVP's `vercel.json` block.
 *
 * These pages render merchant content edited in /admin (arbitrary HTML/CSS
 * from the visual editor, Google Fonts, Google Maps and YouTube/Vimeo
 * embeds), so the policy allows https sources broadly but still: no plugins,
 * no framing by other sites, no form posts to other origins, and MIME
 * sniffing off. The admin editor previews the page in a same-origin iframe,
 * hence `frame-ancestors 'self'` rather than `'none'`.
 */
const contentSecurityPolicy = [
  "default-src 'self' https:",
  `script-src 'self' 'unsafe-inline' https:${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https:",
  "font-src 'self' data: https:",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https:",
  `connect-src 'self' https:${isDev ? " ws: wss: http://localhost:* http://127.0.0.1:*" : ""}`,
  "frame-src 'self' https://www.google.com https://maps.google.com https://www.youtube.com https://player.vimeo.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=()" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework/version.
  poweredByHeader: false,
  // Keep browser source maps out of production bundles (Final-MVP:
  // GENERATE_SOURCEMAP=false).
  productionBrowserSourceMaps: false,
  images: {
    // Local static images only; no remote domains needed.
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        // /<slug>/admin and its API: editor sessions and drafts, never cached
        // by a shared cache, never indexed.
        source: "/:slug/admin/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/api/sites/:slug/admin/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
