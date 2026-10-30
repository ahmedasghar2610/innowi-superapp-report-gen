import {
  DROP_INDICATOR_ID,
  HOVER_ATTR,
  ID_ATTR,
  NON_TEXT_TAGS,
  SEL_ATTR,
  TEXT_TAGS,
  WIDGET_ATTR,
} from "./constants";
import type { FeedbackBehavior, Selection } from "./types";
import { widgetName } from "./widgets";

let counter = 0;

/** Stable id for elements that the editor styles, moves or lists. */
export function ensureId(el: HTMLElement): string {
  let id = el.getAttribute(ID_ATTR);
  if (!id) {
    counter += 1;
    id = `${Date.now().toString(36).slice(-4)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    el.setAttribute(ID_ATTR, id);
  }
  return id;
}

export function byId(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[${ID_ATTR}="${id}"]`);
}

export function summarizeText(el: Element, max = 60): string {
  return (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, max);
}

const SEMANTIC: Record<string, string> = {
  header: "Header",
  nav: "Navigation",
  main: "Main",
  section: "Section",
  article: "Article",
  aside: "Aside",
  footer: "Footer",
  form: "Form",
  ul: "List",
  ol: "List",
  li: "List item",
  img: "Image",
  picture: "Image",
  svg: "Icon",
  a: "Link",
  button: "Button",
  p: "Paragraph",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  h4: "Heading 4",
  h5: "Heading 5",
  h6: "Heading 6",
  video: "Video",
  iframe: "Embed",
  table: "Table",
  input: "Input",
  textarea: "Textarea",
  select: "Select",
  label: "Label",
  blockquote: "Quote",
  figure: "Figure",
  span: "Text",
  hr: "Divider",
};

/** Human label for the layers panel / breadcrumb. */
export function labelFor(el: Element): string {
  const widget = el.getAttribute(WIDGET_ATTR);
  if (widget) return widgetName(widget);
  const tag = el.tagName.toLowerCase();
  const cls = el.getAttribute("class") || "";
  const elementorWidget = Array.from(cls.matchAll(/(?:^|\s)elementor-widget-([a-z0-9-]+)(?=\s|$)/g))
    .map((m) => m[1])
    .find((name) => !/^(container|tablet|mobile|desktop|empty|laptop|widescreen)$/.test(name) && !name.includes("__"));
  if (elementorWidget) {
    return elementorWidget
      .split(/-/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  if (/\belementor-section\b|\bwp-block-group\b|\bcontainer\b/.test(cls) && tag === "div") return "Section";
  if (/\be-con\b|\belementor-container\b|\belementor-column\b|\bcol-|\bcolumn\b|\brow\b/.test(cls) && tag === "div") {
    return /\bcol|column/.test(cls) ? "Column" : "Container";
  }
  if (/\belementor-widget\b/.test(cls)) return "Widget";
  if (SEMANTIC[tag]) return SEMANTIC[tag];
  if (tag === "div") return "Box";
  return tag.toUpperCase();
}

/**
 * True for an element whose value belongs to the merchant Profile (a linked
 * website's name, phone, email, address, hours). The API marks these with
 * data-bind-profile; editing them is fine — on save the API keeps the new
 * value on this website only (the Profile is never changed from the site) until
 * that Profile field is next edited. The side panel says so.
 */
export function isProfileField(el: Element): boolean {
  return !!el.closest("[data-bind-profile]");
}

export function isTextEditable(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (NON_TEXT_TAGS.has(tag)) return false;
  if (TEXT_TAGS.has(tag)) return true;
  // Generic element whose direct children include real text.
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && (node.textContent || "").trim()) return true;
  }
  return false;
}

/** Ignore editor-only nodes and text-less wrappers when walking the tree. */
export function isLayerNode(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (["style", "script", "link", "meta", "template", "noscript", "br", "wbr"].includes(tag)) return false;
  if (el.id === DROP_INDICATOR_ID) return false;
  return true;
}

export function layerChildren(el: Element): HTMLElement[] {
  return Array.from(el.children).filter(isLayerNode) as HTMLElement[];
}

export function pickTarget(
  target: EventTarget | null,
  root: HTMLElement,
  opts: { literal?: boolean } = {},
): HTMLElement | null {
  const el = target as HTMLElement | null;
  if (!el || el.nodeType !== 1) return null;
  if (!root.contains(el) || el === root) return null;
  // Inside <svg>, edit the whole svg element.
  const svg = el.closest("svg");
  if (svg && root.contains(svg)) return svg as unknown as HTMLElement;
  // Inside <picture>, edit the img.
  if (el.tagName.toLowerCase() === "source") {
    const img = el.parentElement?.querySelector("img");
    if (img) return img;
  }
  // Inside a Popup/Toast/Snackbar, the parts people edit — icon, heading,
  // message, buttons, close "×" — are selected (and hover-outlined) directly,
  // like anywhere else on the page. Only the widget's empty shell (the card's
  // padding, the backdrop, the toast body wrapper, an automatic icon) selects
  // the widget itself, so its Behavior panel is one click on the card
  // background away.
  // Double-click passes `literal: true` to select even the shell element.
  if (!opts.literal) {
    const host = feedbackShellHost(el);
    if (host && root.contains(host)) return host;
  }
  return el;
}

const FEEDBACK_HOST = `[${WIDGET_ATTR}="popup"],[${WIDGET_ATTR}="toast"],[${WIDGET_ATTR}="snackbar"]`;
// An icon still on its automatic glyph has no text to edit here; selecting
// the widget shows its icon picker in the Content panel instead.
const FEEDBACK_SHELL = ".sb-popup-backdrop, .sb-popup-card, .sb-toast-body, .sb-icon[data-sb-icon-auto]";

/**
 * The Popup/Toast/Snackbar that `el` is the empty shell of (the host itself,
 * its backdrop, card or body wrapper), or null when `el` is real content
 * inside one — or not inside one at all.
 */
export function feedbackShellHost(el: HTMLElement): HTMLElement | null {
  const host = el.closest<HTMLElement>(FEEDBACK_HOST);
  if (!host) return null;
  if (el === host) return host;
  return el.matches(FEEDBACK_SHELL) && el.closest(FEEDBACK_HOST) === host ? host : null;
}

/** The Popup/Toast/Snackbar that contains `el` (or is `el`), if any. */
export function feedbackHostOf(el: Element | null): HTMLElement | null {
  return el ? el.closest<HTMLElement>(FEEDBACK_HOST) : null;
}

/**
 * Where blocks added to a Popup or Toast go: the popup's card, the toast's
 * text column. Null for a Snackbar (one fixed line — no room for blocks) and
 * for anything that isn't one of these widgets.
 */
export function feedbackContentBox(host: HTMLElement): HTMLElement | null {
  if (host.matches(".sb-popup")) return host.querySelector<HTMLElement>(":scope > .sb-popup-card");
  if (host.matches(".sb-toast")) return host.querySelector<HTMLElement>(":scope > .sb-toast-body");
  return null;
}

/**
 * Where a clicked block goes when `sel` is selected, if it should go INSIDE
 * `sel` rather than after it: a Popup/Toast (its card / text), a layout
 * column (a block after a column would become an extra column and push the
 * layout sideways), or any empty box that can hold blocks. Null = after `sel`.
 */
export function insideTarget(sel: HTMLElement): { box: HTMLElement; label: string } | null {
  const host = sel.matches(FEEDBACK_HOST) ? sel : null;
  if (host) {
    const box = feedbackContentBox(host);
    return box ? { box, label: host.matches(".sb-toast") ? "Toast" : "Popup" } : null;
  }
  if (sel.matches(".sb-col")) return { box: sel, label: "Column" };
  if (
    acceptsChildren(sel) &&
    layerChildren(sel).length === 0 &&
    !sel.matches(".sb-image, .sb-spacer, .sb-divider, figure, iframe, video, img, svg")
  ) {
    return { box: sel, label: "Empty box" };
  }
  return null;
}

export function describe(el: HTMLElement, root: HTMLElement): Selection {
  const tag = el.tagName.toLowerCase();
  const id = ensureId(el);
  const parent = el.parentElement;
  const siblings = parent ? layerChildren(parent) : [];
  const index = siblings.indexOf(el);
  const path: Selection["path"] = [];
  let cursor: HTMLElement | null = el;
  while (cursor && cursor !== root) {
    path.unshift({ id: ensureId(cursor), label: labelFor(cursor) });
    cursor = cursor.parentElement;
  }
  const base = {
    id,
    tag,
    label: labelFor(el),
    text: summarizeText(el, 120),
    widget: el.getAttribute(WIDGET_ATTR) || undefined,
    editable: isTextEditable(el),
    locked: isProfileField(el),
    hasParent: !!parent && parent !== root,
    canMoveUp: index > 0,
    canMoveDown: index >= 0 && index < siblings.length - 1,
    path,
  };
  if (tag === "img") {
    const img = el as HTMLImageElement;
    return { ...base, kind: "image", src: img.getAttribute("src") || "", alt: img.getAttribute("alt") || "" };
  }
  if (tag === "a") {
    const toggle = el.getAttribute("data-sb-toggle") || "";
    return {
      ...base,
      kind: "link",
      href: el.getAttribute("href") || "",
      opensTarget: toggle.startsWith("#") ? toggle.slice(1) : undefined,
    };
  }
  if (tag === "video" || tag === "iframe") {
    return { ...base, kind: "video", src: el.getAttribute("src") || "" };
  }
  if (base.widget === "popup" || base.widget === "toast" || base.widget === "snackbar") {
    const ms = (attr: string, fallback: number) => {
      const raw = el.getAttribute(attr);
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) ? n / 1000 : fallback;
    };
    const triggerAttr = el.getAttribute("data-sb-trigger");
    const trigger: FeedbackBehavior["trigger"] =
      triggerAttr === "load" || triggerAttr === "click" || triggerAttr === "submit" ? triggerAttr : "none";
    const targetRaw = el.getAttribute("data-sb-trigger-target") || "";
    const iconEl = el.querySelector<HTMLElement>(".sb-icon");
    const iconAuto = !!iconEl?.hasAttribute("data-sb-icon-auto");
    const variantAttr = el.getAttribute("data-sb-variant");
    const variant =
      variantAttr === "success" || variantAttr === "error" || variantAttr === "warning" || variantAttr === "info" || variantAttr === "delete" || variantAttr === "neutral"
        ? variantAttr
        : undefined;
    const feedback: FeedbackBehavior = {
      kind: base.widget,
      trigger,
      autoOpen: trigger === "load",
      triggerTargetId: targetRaw.startsWith("#") ? targetRaw.slice(1) : undefined,
      preventFormReload: el.hasAttribute("data-sb-prevent-default"),
      delaySec: ms("data-sb-delay", 0),
      frequency: el.getAttribute("data-sb-frequency") === "always" ? "always" : "once",
      autoDismissSec: ms("data-sb-autodismiss", 0),
      position: el.getAttribute("data-sb-position") || (base.widget === "snackbar" ? "bottom-center" : "bottom-right"),
      variant: base.widget === "toast" ? variant || "neutral" : undefined,
      iconAuto,
      iconText: iconEl?.textContent || "",
    };
    return { ...base, kind: base.editable ? "text" : "element", feedback };
  }
  return { ...base, kind: base.editable ? "text" : "element" };
}

/**
 * Remove everything the editor and the effects runtime add at run time so the
 * saved HTML is clean and animations replay on the real site.
 */
export function cleanRuntimeArtifacts(clone: HTMLElement): void {
  clone.querySelectorAll(`[${SEL_ATTR}],[${HOVER_ATTR}],[contenteditable],[spellcheck]`).forEach((el) => {
    el.removeAttribute(SEL_ATTR);
    el.removeAttribute(HOVER_ATTR);
    el.removeAttribute("contenteditable");
    el.removeAttribute("spellcheck");
  });
  clone.querySelectorAll(`#${DROP_INDICATOR_ID}`).forEach((el) => el.remove());

  // Effects runtime state.
  clone.querySelectorAll("[data-sb-anim]").forEach((el) => {
    el.classList.remove("sb-in");
    (el as HTMLElement).style.removeProperty("--sb-delay");
    (el as HTMLElement).style.removeProperty("--sb-duration");
  });
  clone.querySelectorAll("[data-sb-slider]").forEach((el) => {
    const h = el as HTMLElement;
    h.removeAttribute("data-sb-effect");
    ["--sb-gap", "--sb-speed", "--sb-slide-basis"].forEach((p) => h.style.removeProperty(p));
    el.querySelectorAll("[data-sb-track]").forEach((t) => (t as HTMLElement).style.removeProperty("transform"));
    el.querySelectorAll("[data-sb-slide]").forEach((s) => {
      s.classList.remove("sb-active", "swiper-slide-active", "slick-active", "slick-current");
      s.removeAttribute("aria-hidden");
    });
    el.querySelectorAll("[data-sb-dots]").forEach((d) => (d.innerHTML = ""));
    el.querySelectorAll("[data-sb-prev],[data-sb-next]").forEach((b) => b.classList.remove("sb-disabled"));
  });
  clone.querySelectorAll("[data-sb-dots]").forEach((d) => (d.innerHTML = ""));
  clone.querySelectorAll(".sb-open, .sb-collapsed").forEach((el) => {
    el.classList.remove("sb-open", "sb-collapsed");
  });
  // Popup/Toast/Snackbar runtime + editor-preview state (sb-effects.js,
  // VisualEditor's Preview button) and a marker an earlier build saved.
  clone.querySelectorAll(".sb-closing, .sb-timed, .sb-paused, .sb-preview").forEach((el) => {
    el.classList.remove("sb-closing", "sb-timed", "sb-paused", "sb-preview");
  });
  clone.querySelectorAll("[data-sb-ready-trigger]").forEach((el) => el.removeAttribute("data-sb-ready-trigger"));
  clone.querySelectorAll(".sb-popup, .sb-toast, .sb-snackbar").forEach((el) => {
    const h = el as HTMLElement;
    h.style.removeProperty("--sb-stack");
    h.style.removeProperty("--sb-life");
    h.setAttribute("aria-hidden", "true");
  });
  clone.querySelectorAll("[data-sb-parallax],[data-sb-parallax-bg]").forEach((el) => {
    (el as HTMLElement).style.removeProperty("transform");
    (el as HTMLElement).style.removeProperty("background-position-y");
  });
  clone.querySelectorAll(".elementor-nav-menu--dropdown").forEach((el) => {
    const h = el as HTMLElement;
    h.style.removeProperty("max-height");
    h.style.setProperty("--menu-height", "0");
    h.setAttribute("aria-hidden", "true");
    h.classList.remove("elementor-nav-menu--active");
  });
  clone.querySelectorAll(".elementor-menu-toggle.elementor-active").forEach((el) => {
    el.classList.remove("elementor-active");
    el.setAttribute("aria-expanded", "false");
  });
  clone.querySelectorAll('[style=""]').forEach((el) => el.removeAttribute("style"));
  clone.querySelectorAll('[class=""]').forEach((el) => el.removeAttribute("class"));
}

/** Clean innerHTML of the root. */
export function serializeRoot(root: HTMLElement, assetPrefix = ""): string {
  const clone = root.cloneNode(true) as HTMLElement;
  cleanRuntimeArtifacts(clone);
  let html = clone.innerHTML;
  if (assetPrefix) html = html.split(assetPrefix).join("");
  return html;
}

/* ---------- structural operations ---------- */

export function moveUp(el: HTMLElement): boolean {
  const prev = previousLayerSibling(el);
  if (!prev) return false;
  prev.before(el);
  return true;
}

export function moveDown(el: HTMLElement): boolean {
  const next = nextLayerSibling(el);
  if (!next) return false;
  next.after(el);
  return true;
}

function previousLayerSibling(el: Element): HTMLElement | null {
  let cursor = el.previousElementSibling;
  while (cursor && !isLayerNode(cursor)) cursor = cursor.previousElementSibling;
  return cursor as HTMLElement | null;
}

function nextLayerSibling(el: Element): HTMLElement | null {
  let cursor = el.nextElementSibling;
  while (cursor && !isLayerNode(cursor)) cursor = cursor.nextElementSibling;
  return cursor as HTMLElement | null;
}

/** Deep clone with fresh ids so styles can diverge. Returns the copy. */
export function duplicate(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.removeAttribute(SEL_ATTR);
  copy.removeAttribute(HOVER_ATTR);
  copy.removeAttribute("contenteditable");
  // Strip ids on the copy so ensureId assigns new ones lazily; styles are
  // re-attached by the caller via copyStyles().
  copy.querySelectorAll(`[${ID_ATTR}]`).forEach((node) => node.setAttribute("data-sb-copied-from", node.getAttribute(ID_ATTR) || ""));
  copy.querySelectorAll(`[${ID_ATTR}]`).forEach((node) => node.removeAttribute(ID_ATTR));
  if (copy.hasAttribute(ID_ATTR)) {
    copy.setAttribute("data-sb-copied-from", copy.getAttribute(ID_ATTR) || "");
    copy.removeAttribute(ID_ATTR);
  }
  el.after(copy);
  return copy;
}

/** Parse an HTML string into elements in the target document. */
export function parseFragment(doc: Document, html: string): HTMLElement[] {
  const tpl = doc.createElement("template");
  tpl.innerHTML = html.trim();
  return Array.from(tpl.content.children) as HTMLElement[];
}

export function insertAt(
  nodes: HTMLElement[],
  ref: HTMLElement,
  where: "before" | "after" | "inside",
): void {
  if (!nodes.length) return;
  if (where === "before") ref.before(...nodes);
  else if (where === "after") ref.after(...nodes);
  else ref.append(...nodes);
}

/** Can `candidate` receive children dropped "inside" it? */
export function acceptsChildren(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (NON_TEXT_TAGS.has(tag)) return false;
  if (["a", "button", "span", "label", "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "strong", "em", "i", "b", "small", "svg", "path"].includes(tag)) {
    return false;
  }
  return true;
}
