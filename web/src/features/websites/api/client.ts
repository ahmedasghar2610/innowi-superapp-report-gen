import { API_BASE_URL } from "@/lib/constants";
import { api } from "@/lib/api/client";
import type {
  CreateWebsiteInput,
  LinkWebsiteInput,
  MerchantFromWebsiteInput,
  MerchantSuggestion,
  MerchantWebsites,
  UpdateWebsiteInput,
  Website,
  WebsiteAsset,
  WebsiteDocxImport,
  WebsiteLinkPreview,
  WebsiteListQuery,
  WebsiteListResponse,
  WebsitePrefill,
  WebsitePreviewLink,
} from "../types";

/**
 * HTTP client for website intake questionnaires.
 *
 * This used to be its own Axios instance pointed straight at a standalone
 * FastAPI service on :8000 — that service was unauthenticated, so the browser
 * could call it cross-origin and CORS was the only thing that mattered.
 *
 * That service has been merged into the main backend: the endpoints now live at
 * `/api/v1/websites` in the same API as everything else, and every one of them
 * except the public read-by-slug requires a bearer token. The access token is
 * an httpOnly cookie that client-side JS can never read, so these calls have to
 * take the same same-origin hop as the rest of the app —
 * `src/app/api/v1/[...path]/route.ts` reads the cookie server-side, attaches
 * `Authorization: Bearer …`, and forwards to the API.
 *
 * So there is no separate client any more: this module is a thin, typed façade
 * over the shared `api` helpers. Websites inherit transparent token refresh on
 * a 401, the redirect-to-login when the session is genuinely over, and the same
 * normalised `ApiError` every other feature throws — none of which the
 * standalone instance had.
 */

/**
 * Kept for backwards compatibility with anything importing it. Websites are
 * served by the main API now, so this is simply that API's base URL — there is
 * no separate origin to configure, and `NEXT_PUBLIC_WEBSITES_API_BASE_URL` no
 * longer does anything.
 */
export const WEBSITES_API_BASE_URL = API_BASE_URL;

/**
 * Where the public site template (`nextjs-site`) is served. A website's
 * published page is `${SITE_TEMPLATE_BASE_URL}/${slug}` — the template reads
 * that slug back from the API's public `GET /websites/{slug}`, so the two stay
 * in step with no export step in between.
 *
 * Unrelated to the backend merge: the template is still its own app on its own
 * port.
 */
export const SITE_TEMPLATE_BASE_URL = (
  process.env.NEXT_PUBLIC_SITE_TEMPLATE_URL?.trim() || "http://localhost:5050"
).replace(/\/$/, "");

/** The public URL of one website. */
export function siteUrl(slug: string): string {
  return `${SITE_TEMPLATE_BASE_URL}/${slug}`;
}

/** The website's visual editor — only reachable by adding /admin to its URL. */
export function siteAdminUrl(slug: string): string {
  return `${siteUrl(slug)}/admin`;
}

/**
 * Make an image field previewable inside the Super App.
 *
 * Image answers may be a full URL, an uploaded `data:` URI, or a root-relative
 * path like `/images/header-logo.png` — the last kind is served by the site
 * template's `public/` folder, not by this app, so a bare `<img src="/images/…">`
 * here would 404. Point those at the template's origin instead.
 */
export function imagePreviewUrl(value: string): string {
  const src = value.trim();
  if (!src || !src.startsWith("/")) return src;
  // Uploaded website images are served by the API; `/api/v1/…` is this app's
  // same-origin proxy to it, so the path works here as-is.
  if (isUploadedImage(src)) return src;
  return `${SITE_TEMPLATE_BASE_URL}${src}`;
}

/** Where uploaded website images are served from (see POST /websites/assets). */
export const WEBSITE_ASSET_PATH = "/api/v1/websites/assets/";

/** True for an image this app uploaded (a stored file or a legacy data URL). */
export function isUploadedImage(value: string): boolean {
  return value.startsWith(WEBSITE_ASSET_PATH) || value.startsWith("data:");
}

export const websitesApi = {
  /**
   * GET /websites → `{ data, meta }`
   *
   * `limit` / `offset` still work: the merged API accepts them alongside its
   * own `page` / `limit` convention, and returns `offset` and `hasMore` in
   * `meta` next to `page`, `pageCount`, `hasNextPage` and `hasPreviousPage`.
   * Requires `website.view`.
   */
  list(query: WebsiteListQuery = {}): Promise<WebsiteListResponse> {
    return api.get<WebsiteListResponse>("/websites", query);
  },

  /** GET /websites/:key — `key` is the id or the slug. Public on the API. */
  get(id: string): Promise<Website> {
    return api.get<Website>(`/websites/${id}`);
  },

  /** POST /websites → 201. Requires `website.edit`. */
  create(input: CreateWebsiteInput): Promise<Website> {
    return api.post<Website>("/websites", input);
  },

  /**
   * PATCH /websites/:key — `values` replaces the whole answer tree.
   * Requires `website.edit`.
   */
  update(id: string, input: UpdateWebsiteInput): Promise<Website> {
    return api.patch<Website>(`/websites/${id}`, input);
  },

  /**
   * DELETE /websites/:key → 204.
   *
   * Requires `website.delete`, which is manager-and-above — a Marketing
   * Executive gets a 403 here, where the standalone service let anyone delete.
   */
  remove(id: string): Promise<void> {
    return api.del(`/websites/${id}`);
  },

  /**
   * DELETE /websites/:key/content — "Rebuild from form": discard the pages
   * edited in /admin so the site is built from its form answers again.
   */
  rebuildFromForm(id: string): Promise<void> {
    return api.del(`/websites/${id}/content`);
  },

  /**
   * POST /websites/import-docx — read a "One-Page Website Content" .docx into
   * form answers. Nothing is saved. Requires `website.edit`.
   */
  importDocx(file: File): Promise<WebsiteDocxImport> {
    const form = new FormData();
    form.append("file", file);
    return api.postForm<WebsiteDocxImport>("/websites/import-docx", form);
  },

  /**
   * POST /websites/assets — store one image and get back the `url` to put in
   * the website's answers. The URL is public, so the site template can load it.
   */
  uploadImage(file: File): Promise<WebsiteAsset> {
    const form = new FormData();
    form.append("file", file);
    return api.postForm<WebsiteAsset>("/websites/assets", form);
  },

  /* ---------------------------------------------------------- merchant link */

  /** GET /websites/:key/merchant-suggestions — likely owners of an unassigned site. */
  merchantSuggestions(id: string): Promise<MerchantSuggestion[]> {
    return api.get<MerchantSuggestion[]>(`/websites/${id}/merchant-suggestions`);
  },

  /** GET /websites/:key/link-preview — what linking would change. */
  linkPreview(id: string, merchantId: string): Promise<WebsiteLinkPreview> {
    return api.get<WebsiteLinkPreview>(`/websites/${id}/link-preview`, { merchantId });
  },

  /** POST /websites/:key/link — attach to a merchant, resolving conflicts. */
  link(id: string, input: LinkWebsiteInput): Promise<Website> {
    return api.post<Website>(`/websites/${id}/link`, input);
  },

  /** DELETE /websites/:key/link — the site stays, as unassigned. */
  unlink(id: string): Promise<Website> {
    return api.del<Website>(`/websites/${id}/link`);
  },

  /** POST /websites/:key/merchant — create a merchant from the site and link. Requires `merchant.create`. */
  createMerchant(id: string, input: MerchantFromWebsiteInput = {}): Promise<Website> {
    return api.post<Website>(`/websites/${id}/merchant`, input);
  },

  /** GET /merchants/:id/websites — none / external / managed. */
  forMerchant(merchantId: string): Promise<MerchantWebsites> {
    return api.get<MerchantWebsites>(`/merchants/${merchantId}/websites`);
  },

  /** POST /websites/:key/preview-link — signed 24-hour link to a site that isn't public. */
  previewLink(id: string): Promise<WebsitePreviewLink> {
    return api.post<WebsitePreviewLink>(`/websites/${id}/preview-link`, {});
  },

  /** GET /merchants/:id/website-prefill — starter answers from the Profile. */
  prefill(merchantId: string): Promise<WebsitePrefill> {
    return api.get<WebsitePrefill>(`/merchants/${merchantId}/website-prefill`);
  },
};
