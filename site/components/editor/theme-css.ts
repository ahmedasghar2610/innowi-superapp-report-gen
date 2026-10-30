// COPIED from innowi-superapp-web/src/features/site-builder/components/editor/theme-css.ts by scripts/sync-editor.cjs.
// Edit it there, then run `npm run sync-editor`.
// Client-side twin of server/theme-css.ts (this folder's imports must stay
// relative). Drives the live Theme preview inside the editor iframe.
// KEEP IN SYNC with server/theme-css.ts — both are generated from the same
// source; only the SiteTheme import differs.
import type { SiteTheme } from "./types";

type Decl = [prop: string, value: string | undefined];
type Rule = [selector: string, decls: Decl[]];

/** Strip characters that could break out of a declaration or the <style> tag. */
function clean(value: string | undefined | null): string | undefined {
  const v = (value ?? "").replace(/[{};<>]/g, "").trim();
  return v ? v : undefined;
}
function num(n: number | undefined): string | undefined {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : undefined;
}
function px(n: number | undefined): string | undefined {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? `${n}px` : undefined;
}

// Content selectors are scoped under #cloned-root: that raises them above the
// cloned site's own class-based rules, so a value set in the Theme panel is
// actually visible, while per-element Style-panel rules (also #cloned-root
// scoped, and !important) still win. Only fields that have a value produce
// CSS — an empty field leaves the cloned site's own styling untouched.
const R = "#cloned-root";

function rules(theme: SiteTheme): Rule[] {
  const c = theme.colors || {};
  const t = theme.typography || {};
  const b = theme.buttons || {};
  const s = theme.surfaces || {};
  const bodyFont = clean(t.bodyFont);
  const headingFont = clean(t.headingFont) ?? bodyFont;
  const btnBg = clean(b.background) ?? clean(c.accent);
  const btnFg = clean(b.foreground) ?? clean(c.accentForeground);
  const link = clean(c.linkColor);
  // Only inline text links, so a link colour doesn't repaint the site's own
  // header/footer navigation.
  const textLinks = `${R} :is(p, li, td, th, blockquote, figcaption, .sb-text) a:not(.sb-button)`;
  return [
    ["html", [["font-size", px(t.baseSize)]]],
    ["body", [["background-color", clean(c.background)], ["color", clean(c.foreground)]]],
    [R, [["color", clean(c.foreground)], ["font-family", bodyFont], ["font-weight", num(t.bodyWeight)], ["line-height", num(t.bodyLineHeight)]]],
    [`${R} :is(p, li, td, th, label, blockquote, figcaption, input, textarea, select, button)`, [["font-family", bodyFont]]],
    [`${R} :is(h1, h2, h3, h4, h5, h6)`, [
      ["font-family", headingFont],
      ["font-weight", num(t.headingWeight)],
      ["line-height", num(t.headingLineHeight)],
      ["letter-spacing", clean(t.headingLetterSpacing)],
    ]],
    [`${R} h1`, [["font-size", clean(t.h1Size)]]],
    [`${R} h2`, [["font-size", clean(t.h2Size)]]],
    [`${R} h3`, [["font-size", clean(t.h3Size)]]],
    [`${R} h4`, [["font-size", clean(t.h4Size)]]],
    [`${R} h5`, [["font-size", clean(t.h5Size)]]],
    [`${R} h6`, [["font-size", clean(t.h6Size)]]],
    [textLinks, [["color", link]]],
    [`${textLinks}:hover`, [["color", clean(c.linkHoverColor) ?? link]]],
    [`${R} .sb-button`, [
      ["border-radius", clean(b.radius)],
      ["padding-block", clean(b.paddingBlock)],
      ["padding-inline", clean(b.paddingInline)],
      ["font-weight", num(b.fontWeight)],
      ["text-transform", clean(b.textTransform)],
      ["border-width", clean(b.borderWidth)],
      ["border-color", btnBg],
    ]],
    [`${R} .sb-button:not(.sb-button--outline)`, [["background-color", btnBg], ["color", btnFg]]],
    [`${R} .sb-button--outline`, [["color", btnBg]]],
    [`${R} :is(.sb-popup-card, .sb-toast, .sb-snackbar)`, [["box-shadow", clean(s.shadow)]]],
    [`${R} .sb-section:not(.sb-section--dark):not(.sb-section--light)`, [["background-color", clean(c.surface)]]],
    [`${R} .sb-w :is(input, textarea, select), ${R} hr`, [["border-color", clean(c.border)]]],
  ];
}

/** Variables read as fallbacks by sb-widgets.css's .sb-w defaults (accent,
 * muted text, corner radius, content width) so every widget follows them. */
function vars(theme: SiteTheme): Array<[string, string | undefined]> {
  return [
    ["--sb-theme-accent", clean(theme.colors?.accent)],
    ["--sb-theme-muted", clean(theme.colors?.muted)],
    ["--sb-theme-radius", clean(theme.surfaces?.radius)],
    ["--sb-theme-max-width", clean(theme.surfaces?.maxWidth)],
  ];
}

export function serializeThemeCss(theme: SiteTheme | undefined | null): string {
  if (!theme) return "";
  const varLines = vars(theme)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `  ${k}: ${v};`);
  const ruleLines = rules(theme)
    .map(([sel, decls]) => {
      const declBody = decls
        .filter(([, v]) => v !== undefined)
        .map(([p, v]) => `${p}: ${v};`)
        .join(" ");
      return declBody ? `${sel} { ${declBody} }` : "";
    })
    .filter(Boolean);
  if (!varLines.length && !ruleLines.length) return "";
  return ["/* sb-theme */", varLines.length ? `:root {\n${varLines.join("\n")}\n}` : "", ...ruleLines].filter(Boolean).join("\n");
}

/** True when the theme would produce no CSS at all. */
export function isThemeEmpty(theme: SiteTheme | undefined | null): boolean {
  return serializeThemeCss(theme) === "";
}

/** Drop empty strings/undefined so a saved theme only keeps real values. */
export function pruneTheme(theme: SiteTheme | undefined | null): SiteTheme {
  const out: SiteTheme = {};
  if (!theme) return out;
  for (const group of ["colors", "typography", "buttons", "surfaces"] as const) {
    const src = (theme[group] || {}) as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && !v.trim()) continue;
      if (typeof v === "number" && !Number.isFinite(v)) continue;
      kept[k] = v;
    }
    if (Object.keys(kept).length) (out as Record<string, unknown>)[group] = kept;
  }
  return out;
}
