/** App-wide constants. */

/**
 * API base URL for the Axios client.
 *
 * In the BROWSER we must never call an absolute localhost API directly: a
 * different port is a different origin, so the browser blocks it with CORS
 * ("No 'Access-Control-Allow-Origin' header"). We route those requests through
 * the same-origin Next proxy instead (`/api/v1/*` → the API, see
 * next.config.ts), which needs no CORS on the backend.
 *
 * So: if the configured base URL is an absolute localhost URL and we're running
 * in the browser, use the relative `/api/v1` (proxied). Absolute non-localhost
 * URLs (real deployments that have CORS configured) and server-side usage are
 * respected as-is. Setting `NEXT_PUBLIC_API_BASE_URL=/api/v1` yourself is the
 * explicit form of the same thing.
 */
const PROXY_PATH = "/api/v1";

function resolveApiBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const isBrowser = typeof window !== "undefined";
  const isLocalhostAbsolute = !!env && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(env);

  if (isBrowser && isLocalhostAbsolute) return PROXY_PATH;
  return env && env.length > 0 ? env : PROXY_PATH;
}

export const API_BASE_URL = resolveApiBaseUrl();

/** GET /merchants pagination (API_REFERENCE.md §3.2: limit 1–100, default 25). */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
/** Page-size choices offered by the directory pager (Super App §13 asks for 100). */
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export const APP_NAME = "Innowi";
export const APP_TAGLINE = "Marketing Ops Portal";
