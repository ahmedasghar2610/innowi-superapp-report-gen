import Script from "next/script";
import { serializeThemeCss } from "@/lib/site-builder/theme-css";
import { localiseLinks } from "@/lib/editor";
import SiteHead from "./SiteHead";

/**
 * A page saved from the /<slug>/admin editor. Same structure the Site Builder
 * uses for cloned sites — #cloned-root holding the page HTML, the Theme
 * panel's CSS in #sb-theme-css and the Style panel's in #sb-page-css — plus
 * this site's brand fonts/colours and JSON-LD, which still come live from the
 * form answers (SiteHead).
 *
 * `preview`: inside the editor's iframe — no link rewriting and no
 * sb-site.js, whose DOM changes (injected widgets) must never be saved.
 */
export default function EditedPage({ site, content, path = "/", base = "", preview = false }) {
  const page = content.pages[path];
  const themeCss = serializeThemeCss(content.site?.theme) || "";
  const html = preview ? page.html : localiseLinks(page.html, site.slug, content.pages, base);
  const safe = (css) => css.replace(/<\/style/gi, "<\\/style");

  return (
    <>
      <SiteHead site={site} />
      <link rel="stylesheet" href="/sb-effects.css" />
      <link rel="stylesheet" href="/sb-widgets.css" />
      <link rel="stylesheet" href="/sb-a11y.css" />
      {/* suppressHydrationWarning: the /admin editor rewrites these in its
          preview iframe, sometimes before React has hydrated there. */}
      <style id="sb-theme-css" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: safe(themeCss) }} />
      <style id="sb-page-css" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: safe(page.css || "") }} />
      {/* tabIndex -1 makes the skip-link target focusable (WCAG 2.4.1). */}
      <div id="cloned-root" tabIndex={-1} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />
      <Script src="/sb-effects.js" strategy="afterInteractive" />
      {!preview && <Script src="/sb-site.js" strategy="afterInteractive" />}
    </>
  );
}
