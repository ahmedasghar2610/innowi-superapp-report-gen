/* =============================================================================
 * lib/site.js — helpers shared by the template components.
 * ========================================================================== */

import rawConfig from "@/site.config";

/** The active site config. Import this anywhere: `import site from "@/lib/site"`. */
const site = rawConfig;
export default site;

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

/** Relative luminance — used to decide black-or-white text on a colour. */
export function luminance(hex) {
  const c = hexToRgb(hex);
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** Readable foreground colour for a given background. */
export function readableOn(hex) {
  // 0.183 is the crossover where black and white give equal contrast (WCAG).
  return luminance(hex) > 0.183 ? "#111111" : "#ffffff";
}

/**
 * The `:root` custom properties the stylesheet reads. Injected once in
 * app/layout.js, so changing site.config.js re-skins the whole site.
 */
export function themeCssVars(theme = site.theme) {
  return {
    "--primo-primary": theme.primary,
    "--primo-secondary": theme.secondary,
    "--primo-accent": theme.accent,
    "--primo-cream": theme.cream,
    "--primo-gray": theme.gray,
    "--primo-text": theme.text,
    "--primo-on-primary": readableOn(theme.primary),
    "--primo-on-secondary": readableOn(theme.secondary),
    "--primo-on-accent": readableOn(theme.accent),
    "--font-heading": theme.headingFont,
    "--font-body": theme.bodyFont,
  };
}

/** Same thing as a CSS text block, for a plain <style> tag. */
export function themeCss(theme = site.theme) {
  const vars = themeCssVars(theme);
  return `:root{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join("")}}`;
}

/* ---------------------------------------------------------------- images */

/**
 * Inline SVG placeholder, used whenever an image field is left empty.
 * Keeps the layout intact instead of rendering a broken image.
 */
export function placeholder(label = "Image", w = 800, h = 600) {
  const bg = "#e9e4dc";
  const fg = "#9a8f80";
  const stroke = Math.max(2, Math.round(w / 200));
  const r = Math.min(w, h) * 0.17;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="${bg}"/>` +
    `<g fill="none" stroke="${fg}" stroke-width="${stroke}" stroke-linecap="round">` +
    `<circle cx="${w / 2}" cy="${h / 2 - h * 0.05}" r="${r}"/>` +
    `<path d="M${w / 2 - r * 1.8} ${h / 2 + h * 0.2}h${r * 3.6}"/></g>` +
    `<text x="50%" y="${h - Math.max(18, h * 0.08)}" text-anchor="middle" ` +
    `font-family="Arial,Helvetica,sans-serif" font-size="${Math.max(12, Math.round(Math.min(w, h) * 0.07))}" ` +
    `fill="${fg}">${String(label).replace(/[<>&]/g, "")}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Resolve an image field to a usable src, falling back to a placeholder. */
export function imgSrc(value, label, w, h) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return placeholder(label, w, h);
}

/**
 * next/image can't optimise remote hosts that aren't allow-listed in
 * next.config.mjs, and it can't touch data URIs at all — so anything that
 * isn't a local /public path renders unoptimised.
 */
export function isLocalImage(src) {
  return typeof src === "string" && src.startsWith("/");
}

/* ------------------------------------------------------------------ text */

/** Render a config string with single newlines as <br>. */
export function multiline(str) {
  const parts = String(str || "").split("\n");
  return parts.flatMap((line, i) =>
    i === 0 ? [line] : [<br key={i} />, line]
  );
}

/** Strip a phone number down to something `tel:` accepts. */
export function telHref(phone) {
  return `tel:${String(phone || "").replace(/[^0-9+]/g, "")}`;
}
