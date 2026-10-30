import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";
import { API_BASE_URL } from "@/lib/constants";
import { normalizeError } from "./errors";
import type { ListEnvelope, PagedEnvelope } from "@/types/api";

/* ============================================================================
   Centralized API client for the Merchant Profiling backend.

   One Axios instance, one place for base URL, headers, timeout, request/response
   interceptors, query-string serialization and envelope unwrapping. Resource
   modules (./resources/*) build on the `api` helpers; nothing else touches
   Axios directly. Contract per API_REFERENCE.md.
   ========================================================================== */

/* ---- Query-string builder --------------------------------------------------
   The backend combines filters with AND and ignores omitted params
   (API_REFERENCE.md §3.2). So we DROP null / undefined / "" rather than send
   them — an empty filter must not become `?search=`. Used both as the Axios
   `paramsSerializer` and exported for manual URL building.
---------------------------------------------------------------------------- */
export type QueryValue = string | number | boolean | null | undefined;
/** A typed query map you can build by hand. */
export type QueryParams = Record<string, QueryValue>;
/** Params input — `object` so typed query interfaces (which lack an index
 *  signature) are accepted alongside plain maps. */
type QueryInput = object;

/** Serialize params to `a=1&b=2` (no leading `?`), skipping empty values. */
export function serializeQuery(params?: QueryInput): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null || value === "") continue;
    sp.append(key, String(value));
  }
  return sp.toString();
}

/** Build a query string with a leading `?` (empty when no params survive). */
export function buildQuery(params?: QueryInput): string {
  const qs = serializeQuery(params);
  return qs ? `?${qs}` : "";
}

/* ---- Axios instance -------------------------------------------------------- */
export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 20_000,
  paramsSerializer: serializeQuery,
});

/* ---- Request interceptor ---------------------------------------------------
   No token is attached here on purpose: the access token lives in an httpOnly
   cookie (AUTH_RBAC.md §4) that client-side JS can never read, by design (it
   protects the token from XSS). The browser just calls same-origin
   `/api/v1/*` with credentials, and the Next.js route handler at
   src/app/api/v1/[...path]/route.ts reads the cookie server-side and attaches
   `Authorization: Bearer …` before forwarding to the real API — including a
   transparent refresh-and-retry on an expired token. `withCredentials: true`
   is what makes the browser actually send that cookie along.
---------------------------------------------------------------------------- */
apiClient.defaults.withCredentials = true;

/* ---- Response interceptor --------------------------------------------------
   Success passes through untouched. Every rejection is normalized to an
   `ApiError` (message coerced to string[], status preserved) so callers get one
   stable error shape.

   A 401 reaching here means the proxy route already tried (and failed) a
   refresh — the refresh token itself is expired or revoked, so the session
   is genuinely over. Redirect to /login rather than surfacing a raw error
   toast on every stale tab. Skip this for the auth endpoints themselves
   (login failing with 401 is just "wrong password", not a session expiry).
---------------------------------------------------------------------------- */
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const isAuthEndpoint = typeof error.config?.url === "string" && error.config.url.startsWith("/auth/");
    if (error.response?.status === 401 && !isAuthEndpoint && typeof window !== "undefined") {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
    }
    return Promise.reject(normalizeError(error));
  },
);

/* ---- Typed request helpers (envelope-aware) -------------------------------
   Three response shapes are unwrapped here so resources stay declarative:
     get      → bare object
     getList  → `{ data: T[] }`  → T[]
     getPage  → `{ data, meta }` (only GET /merchants)
---------------------------------------------------------------------------- */
async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const res = await apiClient.request<T>(config);
  return res.data;
}

/** Matches the API's longest inline job (JOBS_TIME_BUDGET_S) plus headroom; the proxy allows 800 s. */
const LONG_REQUEST_MS = 800_000;

export const api = {
  get: <T>(url: string, params?: QueryInput): Promise<T> => request<T>({ method: "get", url, params }),

  /**
   * Accepts the platform's `{ data: T[] }` envelope AND a bare `T[]`. Every
   * merchant-scoped list uses the envelope; the catalog lists did not until
   * they were aligned, and a bare array here used to unwrap to `undefined` —
   * which TanStack Query rejects ("Query data cannot be undefined"). Being
   * tolerant means an endpoint's envelope choice can never blank a picker.
   */
  getList: <T>(url: string, params?: QueryInput): Promise<T[]> =>
    request<ListEnvelope<T> | T[]>({ method: "get", url, params }).then((r) =>
      Array.isArray(r) ? r : (r?.data ?? []),
    ),

  getPage: <T>(url: string, params?: QueryInput): Promise<PagedEnvelope<T>> =>
    request<PagedEnvelope<T>>({ method: "get", url, params }),

  post: <T>(url: string, data?: unknown): Promise<T> => request<T>({ method: "post", url, data }),

  /**
   * POST that may run for minutes: on Vercel the API does a sync / menu
   * extraction inside the request itself (app/common/jobs.py), so the normal
   * 20 s timeout would give up while the work is still running.
   */
  postLong: <T>(url: string, data?: unknown): Promise<T> =>
    request<T>({ method: "post", url, data, timeout: LONG_REQUEST_MS }),

  patch: <T>(url: string, data?: unknown): Promise<T> => request<T>({ method: "patch", url, data }),

  put: <T>(url: string, data?: unknown): Promise<T> => request<T>({ method: "put", url, data }),

  del: <T = void>(url: string): Promise<T> => request<T>({ method: "delete", url }),

  /**
   * Multipart POST (file uploads). Axios sets the boundary itself, so the
   * instance's JSON default Content-Type is overridden with `undefined`.
   */
  postForm: <T>(url: string, form: FormData): Promise<T> =>
    request<T>({ method: "post", url, data: form, headers: { "Content-Type": undefined } }),

  /**
   * Absolute href for a streamed file (`downloadPath` on documents / brand
   * assets). Plain anchors go through the same-origin proxy, which attaches the
   * bearer token from the httpOnly cookie — so a normal <a href> works.
   */
  fileUrl: (path: string): string => `${API_BASE_URL}${path}`,
};

// Re-export the error surface so consumers import everything from the client.
export { ApiError, isApiError, fieldErrorsFrom } from "./errors";
export type { PageMeta, PagedEnvelope, ListEnvelope } from "@/types/api";
