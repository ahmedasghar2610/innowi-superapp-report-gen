import { siteThemeStyle } from "@/lib/format";
import { jsonLdFor } from "@/lib/metadata";

/**
 * Per-site <style> (fonts + brand colours as CSS variables) and the JSON-LD
 * block. Used by the live template page and by pages saved from /admin, so
 * both always carry the site's current brand and structured data.
 */
export default function SiteHead({ site }) {
  const jsonLd = jsonLdFor(site);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: siteThemeStyle(site.brand) }} />
      {/* `<` is escaped so no value can close the script tag early. */}
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd.replace(/</g, "\\u003c") }}
        />
      )}
    </>
  );
}
