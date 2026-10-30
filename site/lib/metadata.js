/* =============================================================================
 * lib/metadata.js — the <head> for one slug: title, description, favicon.
 * ========================================================================== */

export function buildMetadata(site) {
  if (!site) return {};

  const name = site.business.name || "Website";
  const title = site.meta.title || name;
  const description =
    site.meta.description || site.business.tagline || site.footer.about || "";

  const icon = site.brand.favicon || site.brand.logo || undefined;
  const apple = site.brand.appleIcon || icon;

  const ogImage = site.hero?.image && !String(site.hero.image).startsWith("data:") ? site.hero.image : undefined;

  let metadataBase;
  try {
    metadataBase = site.meta.siteUrl ? new URL(site.meta.siteUrl) : undefined;
  } catch {
    metadataBase = undefined;
  }

  return {
    metadataBase,
    title,
    description,
    keywords: site.meta.keywords || undefined,
    icons: icon ? { icon, apple } : undefined,
    alternates: site.meta.siteUrl ? { canonical: site.meta.siteUrl } : undefined,
    openGraph: {
      title: site.meta.ogTitle || title,
      description: site.meta.ogDescription || description,
      url: site.meta.siteUrl || undefined,
      siteName: name,
      type: "website",
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

/* ------------------------------------------------------------------ JSON-LD */

/**
 * The page's schema.org block, as a JSON string. A site's own JSON-LD (the
 * content file carries one) is used when it parses; otherwise a Restaurant
 * entity is built from the business details.
 */
export function jsonLdFor(site) {
  if (!site) return "";
  if (site.meta.jsonLd) {
    try {
      return JSON.stringify(JSON.parse(site.meta.jsonLd));
    } catch {
      // fall through to the generated one
    }
  }

  const b = site.business || {};
  if (!b.name) return "";
  // "Lancaster, CA 93536" -> locality / region / postcode.
  const m = String(b.city || "").match(/^\s*([^,]+?)\s*,\s*([A-Za-z]{2})\s+(\S+)\s*$/);
  const data = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: b.name,
    url: site.meta.siteUrl || undefined,
    telephone: b.phone || undefined,
    email: b.email || undefined,
    image: site.hero?.image && !String(site.hero.image).startsWith("data:") ? site.hero.image : undefined,
    address: b.address
      ? {
          "@type": "PostalAddress",
          streetAddress: b.address,
          addressLocality: m ? m[1] : b.city || undefined,
          addressRegion: m ? m[2] : undefined,
          postalCode: m ? m[3] : undefined,
          addressCountry: b.country === "United States" ? "US" : b.country || undefined,
        }
      : undefined,
    hasMenu: site.orderUrl && site.orderUrl !== "#" ? site.orderUrl : undefined,
    potentialAction:
      site.orderUrl && site.orderUrl !== "#" ? { "@type": "OrderAction", target: site.orderUrl } : undefined,
    openingHours: b.hours ? String(b.hours).replace(/\n/g, " ") : undefined,
  };
  return JSON.stringify(data);
}
