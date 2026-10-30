// Ported from site-builder-source-for-developer/lib/studio-preview.ts.
//
// Assembles one complete, self-contained HTML document for a single page of
// a clone/SEO workspace — the cloned markup plus its extracted CSS, the
// shared effects/a11y/widget runtime stylesheets and scripts, and the site's
// fonts and <html>/<body> chrome, all inlined so the browser can render it
// with nothing else. This is what powers "Visit" from the My Clones list
// (see clone-preview route) — no separate Next.js process is started for a
// clone; its pages are served directly from the workspace's stored files.
import type { SiteFile } from "@/features/site-builder/server/content-store";
import { serializeThemeCss } from "@/features/site-builder/server/theme-css";

/** Where this workspace's static assets (/assets/*, /cloned.css, sb-*.css/js) are served from. */
export function studioAssetPrefix(id: string): string {
  return `/api/clone/preview/${id}/assets`;
}

/**
 * Cloned HTML/CSS reference `/assets/...` and `/cloned.css` at the site root.
 * Inside the workspace those files live under public/, so rewrite them to
 * the preview route's asset prefix.
 */
export function prefixPublicUrls(text: string, prefix: string): string {
  return text
    .replace(/(["'(=,\s])\/assets\//g, `$1${prefix}/assets/`)
    .replace(/(["'(])\/cloned\.css/g, `$1${prefix}/cloned.css`);
}

/** Base URL (path segment appended) for navigating between pages inside the preview. */
export function studioPreviewBase(id: string): string {
  return `/api/clone/preview/${id}?path=`;
}

export function previewDocument(
  site: SiteFile,
  page: { title: string; html: string; css?: string },
  prefix: string,
  previewPathBase: string,
): string {
  const fonts = (site.fontHrefs ?? [])
    .map((href) => `<link rel="stylesheet" href="${href.replace(/"/g, "&quot;")}" />`)
    .join("\n    ");
  const htmlClass = site.htmlClass ? ` class="${site.htmlClass.replace(/"/g, "&quot;")}"` : "";
  const theme = site.dataTheme ? ` data-theme="${site.dataTheme.replace(/"/g, "&quot;")}"` : "";
  const bodyClass = site.bodyClass ? ` class="${site.bodyClass.replace(/"/g, "&quot;")}"` : "";
  const lang = (site.lang || "en").replace(/"/g, "");
  const faviconLink = site.faviconPath
    ? `<link rel="icon" href="${prefix}${site.faviconPath.replace(/"/g, "&quot;")}" />`
    : "";
  const themeCss = serializeThemeCss(site.theme);
  return `<!doctype html>
<html lang="${lang}"${htmlClass}${theme}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${page.title.replace(/</g, "&lt;")}</title>
    <base target="_self" />
    ${fonts}
    ${faviconLink}
    <link rel="stylesheet" href="${prefix}/cloned.css" />
    <link rel="stylesheet" href="${prefix}/sb-effects.css" />
    <link rel="stylesheet" href="${prefix}/sb-widgets.css" />
    <link rel="stylesheet" href="${prefix}/sb-a11y.css" />
    <style>html,body{margin:0}#cloned-root{min-height:100%}</style>
    <style id="sb-theme-css">${themeCss.replace(/<\/style/gi, "<\\/style")}</style>
    <style id="sb-page-css">${prefixPublicUrls(page.css || "", prefix).replace(/<\/style/gi, "<\\/style")}</style>
  </head>
  <body${bodyClass}>
    <div id="cloned-root">${prefixPublicUrls(page.html, prefix)}</div>
    <script src="${prefix}/sb-effects.js" defer></script>
    <script>
      // Keep same-site links inside the preview instead of leaving the app.
      document.addEventListener("click", function (event) {
        if (event.defaultPrevented) return;
        var a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
        if (!a) return;
        var href = a.getAttribute("href") || "";
        if (!href || href[0] === "#" || /^(https?:|mailto:|tel:|javascript:)/i.test(href)) return;
        var url = new URL(href, location.origin);
        if (url.pathname.indexOf(${JSON.stringify(prefix)}) === 0) return;
        event.preventDefault();
        location.href = ${JSON.stringify(previewPathBase)} + encodeURIComponent(url.pathname);
      }, false);
    </script>
  </body>
</html>`;
}

/**
 * Styled "page not found" document for the live preview — shown when a
 * requested path doesn't match any page in the clone (including when
 * someone edits the preview URL directly instead of using its own links;
 * see the [...path] catch-all route). Deliberately small and dependency-free
 * (inline styles only, no external stylesheet) since it has to render even
 * when the clone's own CSS/assets can't be resolved. Uses Innowi's own
 * Signal Blue accent — this is Site Builder chrome shown over the clone,
 * not the cloned site's own branding, same as the accessibility widget.
 */
export function notFoundDocument(requestedPath: string, homeHref: string, siteName?: string): string {
  const safePath = requestedPath.replace(/</g, "&lt;");
  const heading = siteName ? `${siteName.replace(/</g, "&lt;")} — Page not found` : "Page not found";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${heading}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body {
        display: grid;
        place-items: center;
        min-height: 100vh;
        padding: 24px;
        background: #f5f6f8;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        color: #32425b;
      }
      .card {
        width: 100%;
        max-width: 420px;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        padding: 36px 32px;
        text-align: center;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 8px 24px rgba(16, 24, 40, 0.06);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        margin: 0 auto 18px;
        border-radius: 999px;
        background: #eaf0fe;
        color: #2c67f5;
      }
      .badge svg { width: 24px; height: 24px; }
      h1 {
        margin: 0 0 8px;
        font-size: 20px;
        font-weight: 600;
        letter-spacing: -0.006em;
        color: #32425b;
      }
      p.desc {
        margin: 0 0 4px;
        font-size: 14px;
        line-height: 1.5;
        color: #6b7280;
      }
      code {
        display: inline-block;
        margin-top: 6px;
        padding: 3px 8px;
        border-radius: 6px;
        background: #f5f6f8;
        border: 1px solid #e5e7eb;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: #32425b;
        word-break: break-all;
      }
      .home-link {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 22px;
        padding: 0 18px;
        height: 36px;
        border-radius: 8px;
        background: #2c67f5;
        color: #ffffff;
        font-size: 14px;
        font-weight: 600;
        text-decoration: none;
        transition: background-color 0.15s ease;
      }
      .home-link:hover { background: #275bd8; }
      .home-link:active { background: #214cb5; }
    </style>
  </head>
  <body>
    <div class="card">
      <span class="badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 0 1 4.7 1.2c0 1.6-2.2 2-2.2 3.3" />
          <path d="M12 17h.01" />
        </svg>
      </span>
      <h1>Page not found</h1>
      <p class="desc">There's nothing here yet at</p>
      <code>${safePath}</code>
      <div>
        <a class="home-link" href="${homeHref}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5.5 10v9a1 1 0 0 0 1 1H10v-5.5h4V20h3.5a1 1 0 0 0 1-1v-9" />
          </svg>
          Back to home
        </a>
      </div>
    </div>
  </body>
</html>`;
}

export function contentTypeFor(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    css: "text/css; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    eot: "application/vnd.ms-fontobject",
    mp4: "video/mp4",
    webm: "video/webm",
    pdf: "application/pdf",
  };
  return map[ext] || "application/octet-stream";
}
