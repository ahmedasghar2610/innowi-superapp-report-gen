import * as cheerio from "cheerio";

export type PageChrome = {
  title: string;
  /** `<html lang>` of the source page (BCP 47), empty when absent. */
  lang: string;
  htmlClass: string;
  bodyClass: string;
  dataTheme: string;
  fontHrefs: string[];
  /** Absolute URL of the source site's own favicon/app icon, when one was found. */
  faviconHref: string;
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** Keep only well-formed BCP 47 tags (e.g. "en", "en-US", "es-419"). */
export function normalizeLang(raw: string): string {
  const value = (raw || "").trim().replace(/_/g, "-");
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(value) ? value : "";
}

// Preferred first: rel values that tend to point at higher-resolution or
// SVG icons over the classic 16x16 "shortcut icon" favicon.
const FAVICON_REL_PRIORITY = [
  "icon",
  "shortcut icon",
  "apple-touch-icon",
  "apple-touch-icon-precomposed",
  "mask-icon",
];

export function extractChrome(html: string, pageUrl: string): PageChrome {
  const $ = cheerio.load(html);
  const htmlEl = $("html");
  const body = $("body");
  const fontHrefs: string[] = [];
  const favicons: { rel: string; href: string }[] = [];

  $("link[rel]").each((_, el) => {
    const rel = ($(el).attr("rel") || "").toLowerCase();
    const href = $(el).attr("href");
    if (!href) return;
    const isFont =
      rel.includes("preload") && ($(el).attr("as") || "").toLowerCase() === "font";
    const isStyle = rel.includes("stylesheet");
    const looksLikeFont =
      /fonts\.(google|gstatic)|font-face|typekit|fonts\.bunny|use\.typekit/i.test(
        href,
      );
    if (isFont || (isStyle && looksLikeFont)) {
      try {
        fontHrefs.push(new URL(href, pageUrl).href);
      } catch {
        fontHrefs.push(href);
      }
    }
    if (FAVICON_REL_PRIORITY.includes(rel)) {
      try {
        favicons.push({ rel, href: new URL(href, pageUrl).href });
      } catch {
        /* ignore malformed favicon href */
      }
    }
  });

  let faviconHref = "";
  for (const wanted of FAVICON_REL_PRIORITY) {
    const hit = favicons.find((f) => f.rel === wanted);
    if (hit) {
      faviconHref = hit.href;
      break;
    }
  }
  if (!faviconHref) {
    // No explicit <link rel="icon">: fall back to the conventional
    // /favicon.ico path every browser requests automatically.
    try {
      faviconHref = new URL("/favicon.ico", pageUrl).href;
    } catch {
      faviconHref = "";
    }
  }

  const dataTheme =
    htmlEl.attr("data-theme") ||
    body.attr("data-theme") ||
    htmlEl.attr("data-bs-theme") ||
    body.attr("data-bs-theme") ||
    "";

  return {
    title: ($("title").first().text() || "").trim(),
    lang: normalizeLang(htmlEl.attr("lang") || htmlEl.attr("xml:lang") || ""),
    htmlClass: (htmlEl.attr("class") || "").trim(),
    bodyClass: (body.attr("class") || "").trim(),
    dataTheme,
    fontHrefs: unique(fontHrefs),
    faviconHref,
  };
}

export function mergeChrome(pages: PageChrome[]): PageChrome {
  const fontHrefs: string[] = [];
  for (const page of pages) fontHrefs.push(...page.fontHrefs);
  const home = pages[0];
  return {
    title: home?.title || "Cloned site",
    lang: home?.lang || pages.find((page) => page.lang)?.lang || "",
    htmlClass: home?.htmlClass || "",
    bodyClass: home?.bodyClass || "",
    dataTheme: home?.dataTheme || "",
    fontHrefs: unique(fontHrefs),
    faviconHref: home?.faviconHref || pages.find((page) => page.faviconHref)?.faviconHref || "",
  };
}
