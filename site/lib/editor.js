/* =============================================================================
 * lib/editor.js — the /<slug>/admin visual editor, server side.
 *
 * A site starts in TEMPLATE MODE: rendered live from its form answers by the
 * components in components/. The first save in /admin stores the page as HTML
 * in the API (`GET/PUT /websites/<slug>/content`); from then on the site is in
 * EDITED MODE and served from those stored pages (components/EditedPage.js)
 * until the Super App's "Rebuild from form" clears them.
 *
 * Kill switch: SITE_EDITOR_ENABLED=false turns /admin off (404) and ignores
 * stored edits, so every site renders from its form answers again. The edits
 * stay in the database untouched.
 * ========================================================================== */

import { API_URL, accessInit, fetchOptions, withAccess } from "./sites";

export const EDITOR_ENABLED = process.env.SITE_EDITOR_ENABLED !== "false";

/** One httpOnly cookie per site, holding the API's site-scoped editor token. */
export function adminCookie(slug) {
  return `sb_admin_${String(slug).replace(/[^a-z0-9-]/gi, "")}`;
}

export function apiUrl(slug, suffix = "") {
  return `${API_URL}/websites/${encodeURIComponent(slug)}${suffix}`;
}

/** The site as saved from /admin, or null (template mode, or editor off). */
export async function getEditedContent(slug, { fresh = false, access } = {}) {
  if (!EDITOR_ENABLED || !slug) return null;
  try {
    const init = access?.token || access?.preview ? accessInit(access) : fresh ? { cache: "no-store" } : fetchOptions();
    const res = await fetch(withAccess(apiUrl(slug, "/content"), access), init);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.pages?.["/"] ? data : null;
  } catch {
    return null;
  }
}

/** The signed-in editor session for this site, or null. */
export async function editorSession(slug, token) {
  if (!EDITOR_ENABLED || !token) return null;
  try {
    const res = await fetch(apiUrl(slug, "/admin/session"), {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Where this app can reach itself, to render a page's snapshot. */
export function selfOrigin(requestUrl) {
  return (process.env.SITE_INTERNAL_URL || new URL(requestUrl).origin).replace(/\/$/, "");
}

/**
 * The page as the template renders it today, as editable HTML — what /admin
 * starts from before anything is saved. Rendered by /<slug>/admin/source
 * (components in snapshot mode) and cut out between its two markers.
 */
/** Header that carries the editor session to /admin/source (server to server). */
export const SNAPSHOT_TOKEN_HEADER = "x-sb-site-token";

export async function buildSnapshot(site, origin, token) {
  const res = await fetch(`${origin}/${encodeURIComponent(site.slug)}/admin/source`, {
    cache: "no-store",
    // A site that isn't public can only be rendered with the editor session.
    headers: token ? { [SNAPSHOT_TOKEN_HEADER]: token } : {},
  });
  if (!res.ok) throw new Error(`Couldn't render the page to edit (${res.status}).`);
  const html = await res.text();
  const start = html.indexOf('<div id="sb-snapshot">');
  const end = html.indexOf('</div><span id="sb-snapshot-end">');
  if (start < 0 || end < 0) throw new Error("Couldn't read the page to edit.");
  const body = html.slice(start + '<div id="sb-snapshot">'.length, end);

  return {
    pages: {
      "/": {
        title: site.meta.title,
        description: site.meta.description || "",
        html: body,
        css: "",
        updatedAt: new Date().toISOString(),
      },
    },
    site: {
      name: site.business.name || site.slug,
      origin: site.meta.siteUrl || origin,
      lang: "en",
      theme: {},
    },
  };
}

/**
 * Point links between a site's own pages at `/<slug>/…`. The editor stores
 * them site-relative ("/about"); this template hosts many sites under one
 * domain. Not applied when the site is served at the root (DEFAULT_SITE).
 */
export function localiseLinks(html, slug, pages, base) {
  if (!base) return html;
  const paths = new Set(Object.keys(pages || {}));
  return html.replace(/href="(\/[^"#?]*)([^"]*)"/g, (match, path, rest) => {
    const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
    if (!paths.has(clean)) return match;
    return `href="${base}${clean === "/" ? "" : clean}${rest}"`;
  });
}
