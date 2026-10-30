/**
 * Base URL for server-side (Next.js route handler) calls to the Merchant
 * Profiling API. Mirrors next.config.ts's API_ORIGIN — route handlers run on
 * the server, so they hit the API directly rather than through the rewrite
 * proxy (which only rewrites browser-origin requests).
 */
export function apiOrigin(): string {
  return process.env.API_ORIGIN ?? "http://localhost:3000";
}

export function apiUrl(path: string): string {
  return `${apiOrigin()}/api/v1${path}`;
}
