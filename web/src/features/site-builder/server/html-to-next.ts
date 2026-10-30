import * as cheerio from "cheerio";
import { applyA11yFixes } from "@/features/site-builder/server/a11y-fixes";
import { STATEMENT_PATH, statementPageRecord } from "@/features/site-builder/server/a11y-statement";
import { mergeChrome } from "@/features/site-builder/server/clone-chrome";
import type { CloneProgress } from "@/features/site-builder/server/clone-progress";
import type { CrawledPage, CrawledSite } from "@/features/site-builder/server/crawler";
import { normalizePath, type PagesFile } from "@/features/site-builder/server/content-store";
import { extractEffects } from "@/features/site-builder/server/effects-extract";
import { fetchBytes, mapPool } from "@/features/site-builder/server/fetch-web";
import {
  pageRecord,
  siteFileFromChrome,
  writePagesFile,
  writeSiteFile,
} from "@/features/site-builder/server/site-content-files";
import { cloneStarterFiles } from "@/features/site-builder/server/starter-files";
import { assetFileName, hostKey } from "@/features/site-builder/server/urls";

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

function extFromContentType(contentType: string, fallback: string): string {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "text/css": "css",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "font/woff2": "woff2",
    "font/woff": "woff",
    "font/ttf": "ttf",
    "font/otf": "otf",
    "application/font-woff": "woff",
    "application/font-woff2": "woff2",
  };
  return map[type] || fallback;
}

function rewriteCssUrls(
  css: string,
  cssUrl: string,
  rewrite: (absolute: string) => string | null,
): string {
  return css.replace(CSS_URL_RE, (full, _quote: string, raw: string) => {
    const value = raw.trim();
    if (!value || value.startsWith("data:") || value.startsWith("#")) return full;
    let absolute: string;
    try {
      absolute = new URL(value, cssUrl).href;
    } catch {
      return full;
    }
    const local = rewrite(absolute);
    if (!local) return full;
    return `url(${JSON.stringify(local)})`;
  });
}

function collectCssUrls(css: string, cssUrl: string): string[] {
  const urls: string[] = [];
  css.replace(CSS_URL_RE, (_full, _q: string, raw: string) => {
    const value = raw.trim();
    if (!value || value.startsWith("data:") || value.startsWith("#")) return "";
    try {
      urls.push(new URL(value, cssUrl).href);
    } catch {
      /* ignore */
    }
    return "";
  });
  return urls;
}

function rewriteHtml(
  page: CrawledPage,
  site: CrawledSite,
  assetMap: Map<string, string>,
): string {
  const $ = cheerio.load(page.html);
  $("script, noscript, base").remove();
  $("link[rel='preload'][as='script']").remove();
  // Scripts are gone, so turn animation / slider / counter intents into the
  // neutral data-sb-* vocabulary replayed by public/sb-effects.js.
  extractEffects($);
  // WCAG 2.1 AA repairs (alt text, names, labels, iframe titles, landmarks).
  // Guesses are tagged data-sb-a11y="…" for the editor's Accessibility panel.
  applyA11yFixes($);

  const rewriteAttr = (el: Parameters<typeof $>[0], attr: string) => {
    const value = $(el).attr(attr);
    if (!value || value.startsWith("data:")) return;
    try {
      const absolute = new URL(value, page.url).href;
      const local = assetMap.get(absolute);
      if (local) $(el).attr(attr, local);
    } catch {
      /* ignore */
    }
  };

  $("img, source, video, audio, use").each((_, el) => {
    rewriteAttr(el, "src");
    rewriteAttr(el, "poster");
    rewriteAttr(el, "href");
    const srcset = $(el).attr("srcset");
    if (srcset) {
      const next = srcset
        .split(",")
        .map((part) => {
          const [url, descriptor] = part.trim().split(/\s+/, 2);
          try {
            const absolute = new URL(url, page.url).href;
            const local = assetMap.get(absolute) || url;
            return descriptor ? `${local} ${descriptor}` : local;
          } catch {
            return part.trim();
          }
        })
        .join(", ");
      $(el).attr("srcset", next);
    }
  });

  $("[style]").each((_, el) => {
    const style = $(el).attr("style");
    if (!style) return;
    $(el).attr(
      "style",
      rewriteCssUrls(style, page.url, (absolute) => assetMap.get(absolute) || null),
    );
  });

  $("style").each((_, el) => {
    const css = $(el).html() || "";
    $(el).html(
      rewriteCssUrls(css, page.url, (absolute) => assetMap.get(absolute) || null),
    );
  });

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    try {
      const absolute = new URL(href, page.url);
      if (hostKey(absolute.hostname) !== hostKey(new URL(site.startUrl).hostname)) {
        return;
      }
      const match = site.pages.find((candidate) => {
        const a = new URL(candidate.url);
        return (
          a.pathname.replace(/\/+$/, "") === absolute.pathname.replace(/\/+$/, "")
        );
      });
      $(el).attr("href", match?.path || absolute.pathname || "/");
    } catch {
      /* ignore */
    }
  });

  $("link[rel]").each((_, el) => {
    const rel = ($(el).attr("rel") || "").toLowerCase();
    if (rel.includes("stylesheet")) $(el).remove();
  });

  return $("body").html() || $.root().html() || "";
}

export async function htmlToNextFiles(
  site: CrawledSite,
  downloadImages: boolean,
  onProgress: (event: CloneProgress) => void,
): Promise<Record<string, string | Buffer>> {
  const files: Record<string, string | Buffer> = {};
  const assetMap = new Map<string, string>();
  const stylesheetUrls = [
    ...new Set(site.pages.flatMap((page) => page.stylesheetUrls)),
  ];
  const imageUrls = [
    ...new Set(site.pages.flatMap((page) => page.imageUrls)),
  ].filter((url) => !url.startsWith("data:"));

  onProgress({
    phase: "assets",
    percent: 76,
    message: `Downloading ${stylesheetUrls.length} stylesheets`,
    current: 0,
    total: stylesheetUrls.length + (downloadImages ? imageUrls.length : 0),
  });

  const extraCssAssets = new Set<string>();

  const cssChunks = await mapPool(stylesheetUrls, 6, async (cssUrl, index) => {
    const got = await fetchBytes(cssUrl);
    onProgress({
      phase: "assets",
      percent: 76 + Math.round(((index + 1) / Math.max(stylesheetUrls.length, 1)) * 6),
      message: `Stylesheet ${index + 1} of ${stylesheetUrls.length}`,
      current: index + 1,
      total: stylesheetUrls.length,
    });
    if (!got) return null;
    const css = got.bytes.toString("utf8");
    for (const nested of collectCssUrls(css, cssUrl)) extraCssAssets.add(nested);
    return { origin: cssUrl, css };
  });

  const downloadList = [
    ...extraCssAssets,
    ...(downloadImages ? imageUrls : []),
  ];

  await mapPool(downloadList, 8, async (assetUrl, index) => {
    if (assetMap.has(assetUrl)) return;
    const got = await fetchBytes(assetUrl);
    if (!got) return;
    const fallback = /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(assetUrl)
      ? "woff2"
      : "bin";
    const ext = extFromContentType(got.contentType, fallback);
    const isFont = /woff|ttf|otf|eot/i.test(ext);
    const folder = isFont
      ? "fonts"
      : ext === "css"
        ? "css"
        : "images";
    const name = assetFileName(assetUrl, ext);
    const publicPath = `/assets/${folder}/${name}`;
    files[`public${publicPath}`] = got.bytes;
    assetMap.set(assetUrl, publicPath);
    if (index % 8 === 0) {
      onProgress({
        phase: "assets",
        percent: 82,
        message: `Saved ${index + 1} of ${downloadList.length} assets`,
        current: index + 1,
        total: downloadList.length,
      });
    }
  });

  const clonedCss = cssChunks
    .filter((chunk): chunk is { origin: string; css: string } => chunk !== null)
    .map(
      (chunk) =>
        `/* --- ${chunk.origin} --- */\n${rewriteCssUrls(chunk.css, chunk.origin, (absolute) => assetMap.get(absolute) || null)}`,
    )
    .join("\n\n");

  files["public/cloned.css"] = clonedCss;

  const byPath = new Map<string, CrawledPage>();
  for (const page of site.pages) {
    if (!byPath.has(page.path)) byPath.set(page.path, page);
  }

  const pagesFile: PagesFile = { pages: {} };
  for (const page of byPath.values()) {
    const inner = rewriteHtml(page, site, assetMap);
    const $ = cheerio.load(page.html);
    const description = ($('meta[name="description"]').attr("content") || "").trim();
    pagesFile.pages[normalizePath(page.path)] = pageRecord(
      page.chrome.title || page.path,
      inner,
      description,
    );
  }
  const chrome = mergeChrome(site.pages.map((page) => page.chrome));

  // Download the source site's own favicon (falls back to /favicon.ico when
  // no <link rel="icon"> was declared — see clone-chrome.ts) so the cloned
  // site shows its original logo in the browser tab instead of the generic
  // Site Builder icon.
  let faviconPath: string | undefined;
  if (chrome.faviconHref) {
    const got = await fetchBytes(chrome.faviconHref);
    if (got && got.bytes.length > 0) {
      const ext = extFromContentType(got.contentType, /\.ico(\?|$)/i.test(chrome.faviconHref) ? "ico" : "png");
      const name = assetFileName(chrome.faviconHref, ext);
      const publicPath = `/assets/icons/${name}`;
      files[`public${publicPath}`] = got.bytes;
      faviconPath = publicPath;

      // Also ship it as Next's file-convention icon (app/icon.<ext> or
      // app/favicon.ico), which Next auto-serves and auto-links in <head>
      // with no code needed — this is what actually wins the browser tab
      // in a standalone `next dev`/`next build`, unlike a manually written
      // <link rel="icon"> alone. Convention only recognizes a handful of
      // extensions; anything else (e.g. a rare "image/x-icon;..." variant
      // mislabeled as something odd) just keeps the <link> tag as its only
      // source and skips this file.
      const CONVENTION_EXTS = new Set(["ico", "png", "jpg", "jpeg", "svg"]);
      if (CONVENTION_EXTS.has(ext)) {
        files[ext === "ico" ? "app/favicon.ico" : `app/icon.${ext}`] = got.bytes;
      }
    }
  }

  // Editable /accessibility statement (linked from the widget) unless the
  // source site already has a page at that path.
  if (!pagesFile.pages[STATEMENT_PATH]) {
    const home = pagesFile.pages["/"] ?? Object.values(pagesFile.pages)[0];
    pagesFile.pages[STATEMENT_PATH] = statementPageRecord({
      siteName: chrome.title || new URL(site.startUrl).hostname,
      origin: site.origin,
      homeHtml: home?.html ?? "",
      otherHtml: Object.values(pagesFile.pages)
        .slice(0, 12)
        .map((page) => page.html),
    });
  }
  writePagesFile(files, pagesFile);

  writeSiteFile(files, siteFileFromChrome(chrome, site.origin, undefined, faviconPath));
  Object.assign(files, cloneStarterFiles(chrome, site.startUrl, Boolean(faviconPath)));
  return files;
}
