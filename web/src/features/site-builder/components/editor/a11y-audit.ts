// Accessibility audit of the editor canvas (#cloned-root inside the iframe).
// Lightweight WCAG 2.1 AA rule set; each issue points at an element by its
// data-sb-id so the panel can select it and apply quick fixes.
// Relative imports only — this folder is copied into generated zips.
import { ensureId } from "./dom";

export type Severity = "critical" | "serious" | "moderate" | "minor";

export type IssueKind =
  | "alt-missing"
  | "alt-guess"
  | "alt-filename"
  | "empty-link"
  | "empty-button"
  | "generic-link"
  | "no-h1"
  | "multi-h1"
  | "heading-skip"
  | "empty-heading"
  | "no-label"
  | "iframe-title"
  | "dup-id"
  | "contrast"
  | "target-size"
  | "positive-tabindex"
  | "new-window";

export type FixKind = "alt" | "decorative" | "aria-label" | "heading-level" | "title" | "remove-tabindex" | "rel-noopener";

export type Issue = {
  key: string;
  kind: IssueKind;
  severity: Severity;
  /** WCAG success criterion, e.g. "1.1.1". */
  wcag: string;
  message: string;
  help: string;
  /** data-sb-id of the offending element; "" for page-level issues. */
  sbId: string;
  label: string;
  fixes: FixKind[];
  /** Current value for inline fix inputs (alt text, aria-label, heading level). */
  value?: string;
};

export type AuditSummary = { critical: number; serious: number; moderate: number; minor: number; total: number };

const GENERIC_LINK_RE = /^(click here|here|read more|more|learn more|link|this|details|continue|go|view|see more|más|leer más|aquí|clic aquí|ver más)[.!…]*$/i;
const MAX_CONTRAST_CHECKS = 600;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function text(el: Element): string {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function shortLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const t = text(el).slice(0, 40);
  if (t) return `${tag}: “${t}${text(el).length > 40 ? "…" : ""}”`;
  const src = el.getAttribute("src") || el.getAttribute("href") || "";
  if (src) return `${tag}: ${src.split("/").pop()?.split("?")[0] || src}`.slice(0, 50);
  return `<${tag}>`;
}

function isVisible(el: HTMLElement, win: Window): boolean {
  if (el.closest("[aria-hidden='true'], [hidden]")) return false;
  const style = win.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}

function accessibleName(el: Element): string {
  const aria = (el.getAttribute("aria-label") || "").trim();
  if (aria) return aria;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const doc = el.ownerDocument;
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => text(doc.getElementById(id) || el))
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  const own = text(el);
  if (own) return own;
  const alts = Array.from(el.querySelectorAll("img[alt], [aria-label], svg title"))
    .map((c) => (c.getAttribute("alt") || c.getAttribute("aria-label") || c.textContent || "").trim())
    .filter(Boolean);
  if (alts.length) return alts.join(" ");
  const value = (el as HTMLInputElement).value;
  if (typeof value === "string" && value.trim() && /^(submit|button|reset)$/i.test(el.getAttribute("type") || "")) return value.trim();
  return (el.getAttribute("title") || "").trim();
}

function hasLabel(el: HTMLElement): boolean {
  if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title")) return true;
  const id = el.id;
  if (id && el.ownerDocument.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`)) return true;
  return !!el.closest("label");
}

/* colour parsing + WCAG contrast */

type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba | null {
  const m = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i) || value.match(/rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.%]+)\s*)?\)/i);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), isNaN(a) ? 1 : a];
}

function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3] + bg[3] * (1 - fg[3]);
  if (a === 0) return [0, 0, 0, 0];
  return [
    (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / a,
    (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / a,
    (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / a,
    a,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Effective background walking up ancestors; null when an image/gradient makes it unknowable. */
function effectiveBackground(el: HTMLElement, win: Window): Rgba | null {
  let acc: Rgba = [0, 0, 0, 0];
  let node: HTMLElement | null = el;
  while (node) {
    const cs = win.getComputedStyle(node);
    if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
    const bg = parseColor(cs.backgroundColor);
    if (bg && bg[3] > 0) {
      acc = composite(acc, bg);
      if (acc[3] >= 0.999) return acc;
    }
    node = node.parentElement;
  }
  // Default canvas is white.
  return composite(acc, [255, 255, 255, 1]);
}

function hasDirectText(el: Element): boolean {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3 && (child.textContent || "").trim().length > 1) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* audit                                                               */
/* ------------------------------------------------------------------ */

export function auditRoot(root: HTMLElement): Issue[] {
  const win = root.ownerDocument.defaultView;
  if (!win) return [];
  const issues: Issue[] = [];
  const push = (partial: Omit<Issue, "key">) => {
    issues.push({ ...partial, key: `${partial.kind}:${partial.sbId || issues.length}` });
  };
  const idOf = (el: HTMLElement) => ensureId(el);

  /* images (1.1.1) */
  root.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    if (!isVisible(img, win)) return;
    const alt = img.getAttribute("alt");
    const marker = img.getAttribute("data-sb-a11y");
    const file = (img.getAttribute("src") || "").split("/").pop()?.split(/[?#]/)[0] || "";
    if (alt === null) {
      push({ kind: "alt-missing", severity: "critical", wcag: "1.1.1", message: "Image has no alt attribute", help: "Describe the image, or mark it decorative if it adds no information.", sbId: idOf(img), label: shortLabel(img), fixes: ["alt", "decorative"], value: "" });
    } else if (marker === "alt-guess") {
      push({ kind: "alt-guess", severity: "serious", wcag: "1.1.1", message: alt ? `Alt text was guessed at clone time: “${alt}”` : "Image had no alt text; left empty for review", help: "Confirm or rewrite the description, or mark the image decorative.", sbId: idOf(img), label: shortLabel(img), fixes: ["alt", "decorative"], value: alt });
    } else if (alt && file && alt.trim().toLowerCase() === file.toLowerCase()) {
      push({ kind: "alt-filename", severity: "serious", wcag: "1.1.1", message: "Alt text is the file name", help: "Replace with a real description of the image.", sbId: idOf(img), label: shortLabel(img), fixes: ["alt", "decorative"], value: alt });
    }
  });

  /* links and buttons (2.4.4, 4.1.2) */
  root.querySelectorAll<HTMLElement>("a[href], button, [role='button'], [role='link'], input[type='submit'], input[type='button'], input[type='image']").forEach((el) => {
    if (!isVisible(el, win)) return;
    const marker = el.getAttribute("data-sb-a11y");
    const name = accessibleName(el);
    const isLink = el.tagName === "A" || el.getAttribute("role") === "link";
    if (!name) {
      push({
        kind: isLink ? "empty-link" : "empty-button",
        severity: "critical",
        wcag: isLink ? "2.4.4" : "4.1.2",
        message: isLink ? "Link has no text or label" : "Button has no text or label",
        help: "Screen readers announce this as just “link” / “button”. Add a short label describing the action or destination.",
        sbId: idOf(el),
        label: shortLabel(el),
        fixes: ["aria-label"],
        value: "",
      });
      return;
    }
    if (marker === "empty-link") el.removeAttribute("data-sb-a11y");
    if (isLink && GENERIC_LINK_RE.test(name)) {
      push({ kind: "generic-link", severity: "moderate", wcag: "2.4.4", message: `Link text “${name}” does not describe the destination`, help: "Make the link text meaningful on its own (e.g. “Read the pricing guide”), or add an aria-label.", sbId: idOf(el), label: shortLabel(el), fixes: ["aria-label"], value: el.getAttribute("aria-label") || "" });
    }
    if (isLink && el.getAttribute("target") === "_blank") {
      const rel = (el.getAttribute("rel") || "").split(/\s+/);
      if (!rel.includes("noopener")) {
        push({ kind: "new-window", severity: "minor", wcag: "3.2.5", message: "Opens a new tab without rel=\"noopener\"", help: "Add rel=\"noopener\" and mention the new tab in the link text.", sbId: idOf(el), label: shortLabel(el), fixes: ["rel-noopener"] });
      }
    }
  });

  /* headings (1.3.1, 2.4.6) */
  const headings = Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")).filter((h) => isVisible(h, win));
  const h1s = headings.filter((h) => h.tagName === "H1");
  if (headings.length && h1s.length === 0) {
    push({ kind: "no-h1", severity: "serious", wcag: "1.3.1", message: "Page has no <h1>", help: "Every page should have exactly one top-level heading that names the page. Change the main heading's level to H1.", sbId: idOf(headings[0]), label: shortLabel(headings[0]), fixes: ["heading-level"], value: headings[0].tagName.slice(1) });
  }
  if (h1s.length > 1) {
    h1s.slice(1).forEach((h) => push({ kind: "multi-h1", severity: "moderate", wcag: "1.3.1", message: `${h1s.length} <h1> headings on the page`, help: "Keep one H1 per page; demote the others to H2.", sbId: idOf(h), label: shortLabel(h), fixes: ["heading-level"], value: "1" }));
  }
  let last = 0;
  headings.forEach((h) => {
    const level = Number(h.tagName.slice(1));
    if (!text(h) && !h.querySelector("img[alt]:not([alt=''])") && h.getAttribute("aria-hidden") !== "true") {
      push({ kind: "empty-heading", severity: "moderate", wcag: "1.3.1", message: `Empty <h${level}>`, help: "Add text or delete the heading.", sbId: idOf(h), label: shortLabel(h), fixes: [] });
    }
    if (last && level > last + 1) {
      push({ kind: "heading-skip", severity: "moderate", wcag: "1.3.1", message: `Heading level skipped: h${last} → h${level}`, help: "Heading levels should step down one at a time so the outline makes sense to screen-reader users.", sbId: idOf(h), label: shortLabel(h), fixes: ["heading-level"], value: String(level) });
    }
    last = level;
  });

  /* form controls (1.3.1, 3.3.2) */
  root.querySelectorAll<HTMLElement>("input, select, textarea").forEach((el) => {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type)) return;
    if (!isVisible(el, win)) return;
    if (hasLabel(el)) {
      if (el.getAttribute("data-sb-a11y") === "no-label") el.removeAttribute("data-sb-a11y");
      return;
    }
    push({ kind: "no-label", severity: "critical", wcag: "3.3.2", message: "Form field has no label", help: "Add a visible <label>, or an aria-label that says what to enter.", sbId: idOf(el), label: shortLabel(el) + (el.getAttribute("placeholder") ? ` (${el.getAttribute("placeholder")})` : ""), fixes: ["aria-label"], value: el.getAttribute("placeholder") || "" });
  });

  /* iframes (4.1.2) */
  root.querySelectorAll<HTMLIFrameElement>("iframe").forEach((el) => {
    if (!isVisible(el, win)) return;
    if ((el.getAttribute("title") || "").trim()) return;
    push({ kind: "iframe-title", severity: "serious", wcag: "4.1.2", message: "Embedded frame has no title", help: "Give the frame a title that says what it contains (e.g. “YouTube video: Our story”).", sbId: idOf(el), label: shortLabel(el), fixes: ["title"], value: "" });
  });

  /* duplicate ids (4.1.1) */
  const seen = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>("[id]").forEach((el) => {
    const id = el.id;
    if (!id) return;
    if (seen.has(id)) {
      push({ kind: "dup-id", severity: "minor", wcag: "4.1.1", message: `Duplicate id “${id}”`, help: "Ids must be unique; duplicates break labels and anchor links.", sbId: idOf(el), label: shortLabel(el), fixes: [] });
    } else seen.set(id, el);
  });

  /* positive tabindex (2.4.3) */
  root.querySelectorAll<HTMLElement>("[tabindex]").forEach((el) => {
    const v = parseInt(el.getAttribute("tabindex") || "", 10);
    if (v > 0) push({ kind: "positive-tabindex", severity: "moderate", wcag: "2.4.3", message: `tabindex="${v}" overrides the natural focus order`, help: "Use tabindex=\"0\" (or none) so keyboard order follows the page order.", sbId: idOf(el), label: shortLabel(el), fixes: ["remove-tabindex"] });
  });

  /* contrast (1.4.3) */
  let checked = 0;
  const textNodes = Array.from(root.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6, a, li, span, button, label, td, th, div, small, strong, em, blockquote, figcaption"));
  for (const el of textNodes) {
    if (checked >= MAX_CONTRAST_CHECKS) break;
    if (!hasDirectText(el) || !isVisible(el, win)) continue;
    const rects = el.getClientRects();
    if (!rects.length || (rects[0].width === 0 && rects[0].height === 0)) continue;
    checked += 1;
    const cs = win.getComputedStyle(el);
    const fg = parseColor(cs.color);
    if (!fg) continue;
    if (cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color && cs.webkitTextFillColor.includes("rgba(0, 0, 0, 0)")) continue; // gradient text
    const bg = effectiveBackground(el, win);
    if (!bg) continue;
    const fgFlat = fg[3] < 1 ? composite(fg, bg) : fg;
    const ratio = contrastRatio(fgFlat, bg);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || (cs.fontWeight === "bold" ? 700 : 400);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const needed = large ? 3 : 4.5;
    if (ratio + 0.01 < needed) {
      push({ kind: "contrast", severity: ratio < needed - 1.5 ? "serious" : "moderate", wcag: "1.4.3", message: `Text contrast ${ratio.toFixed(2)}:1 (needs ${needed}:1)`, help: "Darken the text or lighten the background in the Style panel until the ratio is met.", sbId: idOf(el), label: shortLabel(el), fixes: [] });
    }
  }

  /* target size (2.5.8, AA in WCAG 2.2 — reported as minor) */
  root.querySelectorAll<HTMLElement>("a[href], button, [role='button'], input:not([type='hidden']), select").forEach((el) => {
    if (!isVisible(el, win)) return;
    const cs = win.getComputedStyle(el);
    if (cs.display === "inline" && el.tagName === "A" && el.parentElement && hasDirectText(el.parentElement)) return; // inline text link exemption
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (rect.width < 24 || rect.height < 24) {
      push({ kind: "target-size", severity: "minor", wcag: "2.5.8", message: `Click target is ${Math.round(rect.width)}×${Math.round(rect.height)}px (min 24×24)`, help: "Increase padding or size in the Style panel so it is easier to tap.", sbId: idOf(el), label: shortLabel(el), fixes: [] });
    }
  });

  const order: Record<Severity, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return issues;
}

export function summarize(issues: Issue[]): AuditSummary {
  const s: AuditSummary = { critical: 0, serious: 0, moderate: 0, minor: 0, total: issues.length };
  for (const issue of issues) s[issue.severity] += 1;
  return s;
}

/* ------------------------------------------------------------------ */
/* quick fixes (mutate the element; caller handles history/dirty)      */
/* ------------------------------------------------------------------ */

export function applyFix(el: HTMLElement, fix: FixKind, value = ""): HTMLElement {
  switch (fix) {
    case "alt":
      el.setAttribute("alt", value.trim());
      el.removeAttribute("data-sb-a11y");
      return el;
    case "decorative":
      el.setAttribute("alt", "");
      el.setAttribute("role", "presentation");
      el.removeAttribute("data-sb-a11y");
      return el;
    case "aria-label":
      if (value.trim()) el.setAttribute("aria-label", value.trim());
      else el.removeAttribute("aria-label");
      el.removeAttribute("data-sb-a11y");
      return el;
    case "title":
      el.setAttribute("title", value.trim());
      return el;
    case "remove-tabindex":
      el.setAttribute("tabindex", "0");
      return el;
    case "rel-noopener": {
      const rel = (el.getAttribute("rel") || "").split(/\s+/).filter(Boolean);
      if (!rel.includes("noopener")) rel.push("noopener");
      el.setAttribute("rel", rel.join(" "));
      return el;
    }
    case "heading-level": {
      const level = Math.min(6, Math.max(1, parseInt(value, 10) || 2));
      const tag = `h${level}`;
      if (el.tagName.toLowerCase() === tag) return el;
      const next = el.ownerDocument.createElement(tag);
      for (const attr of Array.from(el.attributes)) next.setAttribute(attr.name, attr.value);
      while (el.firstChild) next.appendChild(el.firstChild);
      el.replaceWith(next);
      return next;
    }
    default:
      return el;
  }
}
