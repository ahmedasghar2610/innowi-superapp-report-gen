/* =============================================================================
 * lib/format.js — pure helpers shared by the components.
 *
 * Deliberately free of `fs` so it can be imported from client components too;
 * the filesystem side of things lives in lib/sites.js (server only).
 * ========================================================================== */

/** Brand values used when a site's JSON leaves them out. */
export const BRAND_FALLBACKS = {
  primary: "#39261C",
  secondary: "#F89E1F",
  accent: "#F01827",
  cream: "#F7F1E1",
  gray: "#F5F5F5",
  textColor: "#484848",
  headingFont: '"Barlow Condensed", Impact, "Arial Narrow Bold", sans-serif',
  bodyFont: '"Roboto", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  googleFonts: true,
  googleFontFamilies:
    "family=Barlow+Condensed:wght@400;500;600;700&family=Roboto:wght@400;500;700",
};

/* --------------------------------------------------------------- colours */

function hexToRgb(hex) {
  let h = String(hex || "").trim().replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-f]{6}$/i.test(h)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function luminance(hex) {
  const c = hexToRgb(hex);
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** Black or white, whichever reads better on `hex`. */
export function readableOn(hex) {
  // 0.183 is the crossover where black and white give equal contrast (WCAG).
  return luminance(hex) > 0.183 ? "#111111" : "#ffffff";
}

/**
 * The brand published as CSS custom properties. Injected on the page wrapper,
 * so Tailwind's primo-* colours follow whatever the slug's JSON says.
 */
export function themeCss(brand) {
  const vars = {
    "--primo-primary": brand.primary,
    "--primo-secondary": brand.secondary,
    "--primo-accent": brand.accent,
    "--primo-cream": brand.cream,
    "--primo-gray": brand.gray,
    "--primo-text": brand.textColor,
    "--primo-on-primary": readableOn(brand.primary),
    "--primo-on-secondary": readableOn(brand.secondary),
    "--primo-on-accent": readableOn(brand.accent),
    "--font-heading": brand.headingFont,
    "--font-body": brand.bodyFont,
  };
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join("");
}

/** The <style> a site needs: its Google Fonts import, then the brand variables. */
export function siteThemeStyle(brand) {
  const fontImport =
    brand.googleFonts && brand.googleFontFamilies
      ? `@import url("https://fonts.googleapis.com/css2?${brand.googleFontFamilies}&display=swap");`
      : "";
  return `${fontImport}:root{${themeCss(brand)}}`;
}

/* ---------------------------------------------------------------- images */

/** Inline SVG placeholder, drawn whenever an image field is left empty. */
export function placeholder(label = "Image", w = 800, h = 600) {
  const bg = "#e9e4dc";
  const fg = "#9a8f80";
  const r = Math.min(w, h) * 0.17;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="${bg}"/>` +
    `<g fill="none" stroke="${fg}" stroke-width="${Math.max(2, Math.round(w / 200))}" stroke-linecap="round">` +
    `<circle cx="${w / 2}" cy="${h / 2 - h * 0.05}" r="${r}"/>` +
    `<path d="M${w / 2 - r * 1.8} ${h / 2 + h * 0.2}h${r * 3.6}"/></g>` +
    `<text x="50%" y="${h - Math.max(18, h * 0.08)}" text-anchor="middle" ` +
    `font-family="Arial,Helvetica,sans-serif" font-size="${Math.max(12, Math.round(Math.min(w, h) * 0.07))}" ` +
    `fill="${fg}">${String(label).replace(/[<>&]/g, "")}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function imgSrc(value, label, w, h) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return placeholder(label, w, h);
}

/** Only /public paths can go through next/image's optimiser. */
export function isLocalImage(src) {
  return typeof src === "string" && src.startsWith("/");
}

/* ------------------------------------------------------------------ text */

/** Turn a "order" href from labels.js into this site's real ordering URL. */
export function resolveHref(href, site) {
  return href === "order" ? site.orderUrl || "#" : href;
}

/** Render a data string with single newlines as <br>. */
export function multiline(str) {
  const parts = String(str || "").split("\n");
  return parts.flatMap((line, i) => (i === 0 ? [line] : [<br key={i} />, line]));
}

export function telHref(phone) {
  return `tel:${String(phone || "").replace(/[^0-9+]/g, "")}`;
}

/** "44599 Vly Central Wy" + "Lancaster, CA 93536" -> one block of address. */
export function fullAddress(business) {
  return [business.address, business.city].filter(Boolean).join("\n");
}
