// COPIED from innowi-superapp-web/src/features/site-builder/server/theme-detect.ts by scripts/sync-editor.cjs.
// Edit it there, then run `npm run sync-editor`.
// Best-effort extraction of a SiteTheme from a clone's own stylesheet, used
// to pre-fill the editor's Theme panel ("Detect from site") instead of
// starting from blank fields. This is a statistical scan, not a layout
// engine — it counts how declarations actually appear across the cloned
// CSS and picks the most common/likely candidate per token, the same way a
// human skimming the stylesheet would guess "this site's accent is
// probably #2c67f5 because it's on every button". It will occasionally be
// wrong (e.g. picking a decorative color used more often than the real
// brand accent) — the panel only *fills empty fields*, so a manual value
// always wins, and every detected field stays editable afterwards.
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss, { type Rule } from "postcss";
import type { ContentStore, SiteTheme } from "./content-store";

type ColorCount = Map<string, number>;

const HEADING_SEL = /(^|[\s,>+~])h[1-6](\b|[.#:[])/i;
const BODY_SEL = /(^|[\s,>+~])(html|body)(\b|[.#:[])/i;
const BUTTON_SEL = /\b(button|btn|\.cta|\[type=["']?submit["']?\]|\[role=["']?button["']?\])/i;
const LINK_SEL = /(^|[\s,>+~])a(\b|[.#:[])/i;
const CARD_SEL = /\b(card|panel|box|popup|modal|tile)\b/i;

const NAMED_TO_SKIP = new Set(["inherit", "initial", "unset", "currentcolor", "transparent", "none", "auto"]);

function isColorValue(v: string): boolean {
  const s = v.trim().toLowerCase();
  if (!s || NAMED_TO_SKIP.has(s)) return false;
  return /^#([0-9a-f]{3,8})$/.test(s) || /^rgba?\(/.test(s) || /^hsla?\(/.test(s) || /^[a-z]+$/.test(s);
}

function bump(map: ColorCount, key: string | undefined, weight = 1): void {
  if (!key) return;
  const v = key.trim();
  if (!v) return;
  map.set(v, (map.get(v) || 0) + weight);
}

function top(map: ColorCount, min = 1): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [k, count] of map) {
    if (count > bestCount) {
      best = k;
      bestCount = count;
    }
  }
  return bestCount >= min ? best : undefined;
}

/** Rough perceived brightness (0 black - 255 white) for a #rrggbb/#rgb hex color. */
function hexBrightness(hex: string): number | null {
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/** Rough saturation proxy (0-255, higher = more colorful/less gray) for #rrggbb/#rgb. */
function hexSaturation(hex: string): number | null {
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function cleanFontFamily(value: string): string {
  return value
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Read this workspace's own cloned.css (its source-of-truth stylesheet) and
 * detect a SiteTheme from it. Returns an empty/zero result rather than
 * throwing if the file doesn't exist yet (e.g. a brand-new blank site).
 */
export async function detectSiteTheme(store: ContentStore): Promise<DetectedTheme> {
  try {
    const css = await readFile(path.join(store.rootDir, "public", "cloned.css"), "utf8");
    return detectThemeFromCss(css);
  } catch {
    return { theme: {}, foundCount: 0 };
  }
}

export type DetectedTheme = {
  theme: SiteTheme;
  /** Which top-level groups actually found at least one value, for the UI to report "found 9 of 24 fields". */
  foundCount: number;
};

export function detectThemeFromCss(css: string): DetectedTheme {
  const theme: SiteTheme = { colors: {}, typography: {}, buttons: {}, surfaces: {} };
  let found = 0;
  const set = <G extends keyof SiteTheme, K extends keyof NonNullable<SiteTheme[G]>>(group: G, key: K, value: string | number | undefined) => {
    if (value === undefined || value === "") return;
    (theme[group] as Record<string, unknown>)[key as string] = value;
    found += 1;
  };

  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return { theme, foundCount: 0 };
  }

  const bodyBg: ColorCount = new Map();
  const bodyFg: ColorCount = new Map();
  const anyBg: ColorCount = new Map();
  const btnBg: ColorCount = new Map();
  const btnFg: ColorCount = new Map();
  const linkColor: ColorCount = new Map();
  const borderColor: ColorCount = new Map();
  const bodyFonts: ColorCount = new Map();
  const headingFonts: ColorCount = new Map();
  const radii: ColorCount = new Map();
  const shadows: ColorCount = new Map();
  const h1Sizes: ColorCount = new Map();
  const h2Sizes: ColorCount = new Map();
  const btnRadii: ColorCount = new Map();
  const btnPadBlock: ColorCount = new Map();
  const btnPadInline: ColorCount = new Map();
  const maxWidths: ColorCount = new Map();

  root.walkRules((rule: Rule) => {
    const selector = rule.selector || "";
    const isHeading = HEADING_SEL.test(selector);
    const isH1 = /(^|[\s,>+~])h1(\b|[.#:[])/i.test(selector);
    const isH2 = /(^|[\s,>+~])h2(\b|[.#:[])/i.test(selector);
    const isBody = BODY_SEL.test(selector);
    const isButton = BUTTON_SEL.test(selector);
    const isLink = LINK_SEL.test(selector) && !isButton;
    const isCard = CARD_SEL.test(selector);
    const isContainer = /\b(container|wrapper|content|main)\b/i.test(selector) && !isCard;

    rule.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      const value = decl.value.trim();
      if (!value) return;

      if ((prop === "background" || prop === "background-color") && isColorValue(value)) {
        anyBg.set(value, (anyBg.get(value) || 0) + 1);
        if (isBody) bump(bodyBg, value, 5);
        if (isButton) bump(btnBg, value, 3);
      }
      if (prop === "color" && isColorValue(value)) {
        if (isBody) bump(bodyFg, value, 5);
        if (isButton) bump(btnFg, value, 3);
        if (isLink) bump(linkColor, value, 3);
      }
      if (prop === "border-color" && isColorValue(value)) {
        bump(borderColor, value, 1);
      }
      if (prop === "border" && isColorValue(value.split(/\s+/).pop() || "")) {
        bump(borderColor, value.split(/\s+/).pop(), 1);
      }
      if (prop === "font-family") {
        const cleaned = cleanFontFamily(value);
        if (isHeading) bump(headingFonts, cleaned, 3);
        else if (isBody) bump(bodyFonts, cleaned, 5);
        else bump(bodyFonts, cleaned, 1);
      }
      if (prop === "border-radius") {
        if (isButton) bump(btnRadii, value, 3);
        else if (isCard) bump(radii, value, 3);
        else bump(radii, value, 1);
      }
      if (prop === "box-shadow" && value !== "none") {
        bump(shadows, value, isCard ? 3 : 1);
      }
      if (prop === "font-size") {
        if (isH1) bump(h1Sizes, value, 3);
        if (isH2) bump(h2Sizes, value, 3);
      }
      if (prop === "padding-block" || (prop === "padding" && isButton)) {
        if (isButton) bump(btnPadBlock, value, 1);
      }
      if (prop === "padding-inline") {
        if (isButton) bump(btnPadInline, value, 1);
      }
      if (prop === "max-width" && isContainer) {
        bump(maxWidths, value, 1);
      }
    });
  });

  // Colors -------------------------------------------------------------
  const background = top(bodyBg) ?? top(anyBg, 3);
  set("colors", "background", background);

  const foreground = top(bodyFg);
  set("colors", "foreground", foreground);

  // Accent: prefer the most common button background; if none, the most
  // saturated frequently-used color (buttons/links are usually the most
  // colorful thing on an otherwise neutral page).
  let accent = top(btnBg, 2);
  if (!accent) {
    let bestScore = -1;
    for (const [color, count] of anyBg) {
      const sat = hexSaturation(color);
      if (sat === null || count < 2) continue;
      const score = sat * Math.log2(count + 1);
      if (score > bestScore) {
        bestScore = score;
        accent = color;
      }
    }
  }
  set("colors", "accent", accent);
  set("colors", "accentForeground", top(btnFg));
  set("colors", "border", top(borderColor));
  set("colors", "linkColor", top(linkColor) ?? accent);

  // Surface: a light tint distinct from the page background, used behind
  // cards/sections — only set if it's clearly different from `background`.
  const surfaceCandidate = Array.from(anyBg.entries())
    .filter(([v]) => v !== background)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  if (surfaceCandidate) set("colors", "surface", surfaceCandidate);

  // Typography -----------------------------------------------------------
  set("typography", "bodyFont", top(bodyFonts));
  const headingFont = top(headingFonts);
  if (headingFont && headingFont !== theme.typography?.bodyFont) set("typography", "headingFont", headingFont);
  set("typography", "h1Size", top(h1Sizes));
  set("typography", "h2Size", top(h2Sizes));

  // Buttons ----------------------------------------------------------
  set("buttons", "background", top(btnBg, 2));
  set("buttons", "foreground", top(btnFg));
  set("buttons", "radius", top(btnRadii));
  set("buttons", "paddingBlock", top(btnPadBlock));
  set("buttons", "paddingInline", top(btnPadInline));

  // Surfaces -----------------------------------------------------------
  set("surfaces", "radius", top(radii) ?? top(btnRadii));
  set("surfaces", "shadow", top(shadows));
  set("surfaces", "maxWidth", top(maxWidths));

  return { theme, foundCount: found };
}

/** Detected values whose hue reads as "probably not a real brand accent"
 * (near-black/near-white/gray) are still returned — the caller decides
 * whether to surface a low-confidence notice; kept simple on purpose. */
export function isLikelyNeutral(hex: string): boolean {
  const brightness = hexBrightness(hex);
  const saturation = hexSaturation(hex);
  if (brightness === null || saturation === null) return false;
  return saturation < 12 || brightness > 250 || brightness < 8;
}
