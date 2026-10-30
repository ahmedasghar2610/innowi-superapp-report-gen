/* =============================================================================
 * lib/sites.js — where a site's data comes from.
 *
 * Two sources, tried in order:
 *
 *   1. The Innowi Super App API. Every website filled in through the Super
 *      App's Website module lives there, and its `slug` is this template's URL:
 *
 *        GET /api/v1/websites            ->  every slug   (needs a token)
 *        GET /api/v1/websites/<slug>     ->  one site     (public)
 *
 *      These endpoints used to be a standalone FastAPI service on :8000; that
 *      service has been merged into the main API. Reading one site by slug is
 *      deliberately public — it is the page the merchant is publishing — so
 *      this template still needs no credentials to render. Only the *listing*
 *      is gated, and that is used solely to pre-render slugs at build time.
 *
 *   2. data/sites/<slug>.json, as before. Kept as a fallback so the bundled
 *      demo sites still work with the API stopped, and so a site can be
 *      committed to the repo without going through the app.
 *
 * The API stores the answers exactly as the Website Details Form writes them,
 * which is the same shape these JSON files already use — so both sources go
 * through the same normaliser below.
 *
 * Server-only (it touches `fs`).
 * ========================================================================== */

import fs from "fs";
import path from "path";

import { BRAND_FALLBACKS } from "./format";
import { resolveLabels } from "./labels";

const SITES_DIR = path.join(process.cwd(), "data", "sites");

/**
 * Where the intake API lives. Set WEBSITE_API_URL to point elsewhere.
 *
 * The default is the merged Super App API. It was `http://localhost:8000/api`
 * when websites had their own service — a stale value there is silently fatal:
 * every fetch fails, the code falls back to `data/sites/*.json`, and any slug
 * without a committed JSON file 404s.
 */
export const API_URL = (process.env.WEBSITE_API_URL || "http://localhost:3000/api/v1").replace(/\/$/, "");

/**
 * Images uploaded in the Super App are stored by the API and saved in a site's
 * answers as `/api/v1/websites/assets/…` — a path, so the Super App can load
 * them through its own same-origin proxy. Here they need the API's origin.
 */
export const API_ORIGIN = (() => {
  try {
    return new URL(API_URL).origin;
  } catch {
    return "";
  }
})();

function absolutiseAssets(node) {
  if (typeof node === "string") {
    return API_ORIGIN && node.startsWith("/api/v1/websites/assets/") ? `${API_ORIGIN}${node}` : node;
  }
  if (Array.isArray(node)) return node.map(absolutiseAssets);
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, absolutiseAssets(v)]));
  }
  return node;
}

/**
 * Optional bearer token, used ONLY for the listing call.
 *
 * `GET /websites` requires the `website.view` capability now. Without a token
 * the list 401s, `generateStaticParams` sees only the local JSON files, and
 * API-only slugs are rendered on demand instead of at build time — which
 * `dynamicParams = true` already allows. So this stays optional.
 */
const API_TOKEN = process.env.WEBSITE_API_TOKEN?.trim() || "";

/**
 * Seconds to cache an API response. 0 (the default) re-fetches every request,
 * so an edit in the Super App shows on the next refresh. Set something like
 * 60 in production to stop every visit hitting the API.
 */
const REVALIDATE = Number(process.env.SITE_REVALIDATE || 0);

/**
 * The slug served at "/".
 *
 * Empty by default on purpose: this template hosts many merchants' sites, and
 * hard-coding one of them as the root would give it a privileged URL the others
 * can't have. Every site is reached at its own `/<slug>` and nothing else.
 *
 * Set DEFAULT_SITE in .env when this deployment serves ONE merchant — e.g. a
 * per-domain deploy where primocafe.com should show that site at its root.
 */
export const DEFAULT_SLUG = process.env.DEFAULT_SITE?.trim() || "";

export const fetchOptions = () => {
  const options = REVALIDATE > 0 ? { next: { revalidate: REVALIDATE } } : { cache: "no-store" };
  return API_TOKEN ? { ...options, headers: { Authorization: `Bearer ${API_TOKEN}` } } : options;
};

/* ------------------------------------------------------------------ helpers */

/** Drop empty values so they can't shadow a fallback with "". */
function compact(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    out[key] = value;
  }
  return out;
}

const firstOf = (...values) => values.find((v) => typeof v === "string" && v.trim()) || "";

/* -------------------------------------------------------------------- fonts
 * The form collects a plain family name ("Poppins"). The stylesheet needs a
 * full stack, and the family has to actually be fetched — otherwise the page
 * silently falls back to a system serif. Both are derived here.
 * ------------------------------------------------------------------------ */

/** The family name on its own: `"Poppins", sans-serif` -> `Poppins`. */
function familyName(value) {
  return String(value || "")
    .split(",")[0]
    .replace(/["']/g, "")
    .trim();
}

/** `Poppins` -> `"Poppins", <fallbacks>`. A value that is already a stack is left alone. */
function fontStack(value, fallbackStack) {
  const name = familyName(value);
  if (!name) return fallbackStack;
  if (String(value).includes(",")) return value;

  // Keep the fallback's generic tail so the page still reads if the fetch fails.
  const tail = fallbackStack.split(",").slice(1).join(",").trim();
  return `"${name}", ${tail}`;
}

/** The Google Fonts query for the families actually in use. */
function googleFamilies(...values) {
  const seen = new Set();
  const parts = [];

  for (const value of values) {
    const name = familyName(value);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    parts.push(`family=${name.replace(/\s+/g, "+")}:wght@400;500;600;700`);
  }

  return parts.join("&");
}

/**
 * One site's data, whatever the source, filled out so a half-finished form
 * still renders instead of throwing.
 *
 * `orderUrl` is the single link every Order button points at. The form has a
 * dedicated field for it, but older records only have the per-section call to
 * action links — so those are used as a fallback.
 */
function normalise(slug, input) {
  const raw = absolutiseAssets(input || {});
  const business = raw.business || {};
  const brand = compact(raw.brand);
  const footer = raw.footer || {};
  const meta = raw.meta || {};
  const social = raw.social || {};

  const headingFont = fontStack(brand.headingFont, BRAND_FALLBACKS.headingFont);
  const bodyFont = fontStack(brand.bodyFont, BRAND_FALLBACKS.bodyFont);
  // A site that names its own fonts needs those fetched, not the defaults.
  const customFonts = Boolean(brand.headingFont || brand.bodyFont);

  return {
    slug,
    orderUrl: firstOf(raw.orderUrl, raw.hero?.ctaLink, raw.about?.ctaLink, raw.offerings?.ctaLink) || "#",
    business,
    meta: {
      title: firstOf(meta.title, business.name, "Website"),
      description: firstOf(meta.description, business.tagline, footer.about),
      ogTitle: firstOf(meta.ogTitle),
      ogDescription: firstOf(meta.ogDescription),
      keywords: firstOf(meta.keywords),
      siteUrl: firstOf(meta.siteUrl),
      jsonLd: firstOf(meta.jsonLd),
    },
    labels: withoutMissingSections(resolveLabels(raw), raw),
    brand: {
      ...BRAND_FALLBACKS,
      ...brand,
      headingFont,
      bodyFont,
      googleFontFamilies: customFonts
        ? googleFamilies(headingFont, bodyFont)
        : BRAND_FALLBACKS.googleFontFamilies,
    },
    hero: raw.hero || {},
    about: raw.about || {},
    offerings: { items: [], ...(raw.offerings || {}) },
    social: {
      points: [],
      reviews: [],
      ...social,
      // Both headings sit above a section that only renders when it has
      // content, so a sensible default beats an empty <h2>.
      heading: firstOf(social.heading, business.name && `Why choose ${business.name}`),
      reviewsHeading: firstOf(social.reviewsHeading, "What our customers say"),
    },
    catering: raw.catering || {},
    contact: raw.contact || {},
    footer,
  };
}

/** Drop nav / footer links to a section this site doesn't render (catering). */
function withoutMissingSections(labels, raw) {
  const hasCatering = Boolean(raw.catering?.heading && String(raw.catering.heading).trim());
  if (hasCatering) return labels;
  const keep = (l) => l.href !== "#catering";
  return {
    ...labels,
    nav: labels.nav.filter(keep),
    footer: { ...labels.footer, quickLinks: labels.footer.quickLinks.filter(keep) },
  };
}

/* ---------------------------------------------------------------- the API */

/**
 * `access` lets a request see a site that isn't public yet (the API trims the
 * record for anonymous callers — see the Super App API's websites/visibility.py):
 *   { preview }  a signed preview link from the Super App (`?preview=…`)
 *   { token }    the site's /admin editor session
 */
function accessQuery(access) {
  return access?.preview ? `${"?"}preview=${encodeURIComponent(access.preview)}` : "";
}

export function accessInit(access) {
  if (!access?.token && !access?.preview) return fetchOptions();
  return {
    cache: "no-store",
    ...(access.token ? { headers: { Authorization: `Bearer ${access.token}` } } : {}),
  };
}

export function withAccess(url, access) {
  const q = accessQuery(access);
  return q ? `${url}${url.includes("?") ? "&" + q.slice(1) : q}` : url;
}

async function apiJson(pathname, access) {
  try {
    const res = await fetch(withAccess(`${API_URL}${pathname}`, access), accessInit(access));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Service down, wrong port, no network — fall back to the JSON files.
    return null;
  }
}

async function apiSlugs() {
  // The API caps `limit` at 100. Asking for more is a 400, not a clamp.
  const body = await apiJson("/websites?limit=100");
  return (body?.data || []).map((w) => w.slug).filter(Boolean);
}

async function apiSite(slug, access) {
  const record = await apiJson(`/websites/${encodeURIComponent(slug)}`, access);
  if (!record) return null;
  // Not public, and this request may not see it: just enough for a
  // "coming soon" page — the API sends no content.
  if (record.restricted) {
    return { slug: record.slug || slug, name: record.name || slug, status: record.status, restricted: true };
  }
  // The answers tree is the site; the record wraps it with id/slug/status.
  return { ...normalise(record.slug || slug, record.values || {}), status: record.status, published: record.published !== false };
}

/* ------------------------------------------------------------- local files */

function fileSlugs() {
  if (!fs.existsSync(SITES_DIR)) return [];
  return fs
    .readdirSync(SITES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function fileSite(slug) {
  const file = path.join(SITES_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return normalise(slug, JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ public */

/**
 * Every slug that can be rendered — the API's, plus any local JSON files.
 *
 * Used by `generateStaticParams` only. When the listing call is unauthorised
 * this returns just the local files; that is not a failure, because
 * `dynamicParams = true` renders any other slug on first request.
 */
export async function listSlugs() {
  const fromApi = await apiSlugs();
  return [...new Set([...fromApi, ...fileSlugs()])];
}

/**
 * Read one site's data, or null when there's no such slug. A site that isn't
 * public comes back as `{ slug, name, status, restricted: true }` unless
 * `access` (preview link / editor session) allows it.
 */
export async function getSite(slug, access) {
  if (!slug) return null;
  return (await apiSite(slug, access)) ?? fileSite(slug);
}
