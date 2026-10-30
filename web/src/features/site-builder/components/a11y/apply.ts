// Applies widget settings to the document (classes on <html>, text scaling,
// overlays, media control). Pure DOM code, no React, relative imports only.
import type { Settings } from "./settings";

const FS_ATTR = "data-sb-a11y-fs";
const WIDGET = ".sb-a11y";

// The effects runtime (public/sb-effects.js) is optional: the Builder itself
// does not load it. Typed loosely here to avoid clashing with the generated
// site's own `Window.SBEffects` declaration in components/EffectsRuntime.tsx.
type EffectsBridge = { setReducedMotion?: (value: boolean) => void };
function effectsBridge(): EffectsBridge | undefined {
  return (window as unknown as { SBEffects?: EffectsBridge }).SBEffects;
}

/* ------------------------------------------------------------------ */
/* classes                                                             */
/* ------------------------------------------------------------------ */

function setClass(root: HTMLElement, name: string, on: boolean) {
  root.classList.toggle(name, on);
}

function setChoice(root: HTMLElement, prefix: string, values: readonly string[], active: string) {
  for (const value of values) root.classList.toggle(`${prefix}${value}`, value === active && active !== "");
}

/* ------------------------------------------------------------------ */
/* text scaling: multiply each element's computed font-size so px-based */
/* sites scale too (root font-size only affects rem/em layouts).        */
/* ------------------------------------------------------------------ */

const TEXT_TAGS =
  "p,li,a,span,h1,h2,h3,h4,h5,h6,td,th,label,button,input,select,textarea,blockquote,figcaption,dd,dt,small,strong,em,b,i,legend,summary,address,cite,q,time,div";

let scaleObserver: MutationObserver | null = null;
let scaleTimer: number | null = null;

function scaleElement(el: HTMLElement, factor: number) {
  let base = el.getAttribute(FS_ATTR);
  if (!base) {
    const computed = parseFloat(getComputedStyle(el).fontSize);
    if (!computed) return;
    base = String(computed);
    el.setAttribute(FS_ATTR, base);
  }
  el.style.setProperty("font-size", `${(parseFloat(base) * factor).toFixed(2)}px`, "important");
}

function applyTextScale(percent: number) {
  const factor = percent / 100;
  const nodes = document.body.querySelectorAll<HTMLElement>(`${TEXT_TAGS}`);
  nodes.forEach((el) => {
    if (el.closest(WIDGET)) return;
    if (factor === 1) {
      if (el.hasAttribute(FS_ATTR)) {
        el.style.removeProperty("font-size");
        el.removeAttribute(FS_ATTR);
      }
      return;
    }
    // Only scale elements that directly contain text; containers inherit.
    let hasText = false;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3 && (child.textContent || "").trim()) {
        hasText = true;
        break;
      }
    }
    if (!hasText && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)) return;
    scaleElement(el, factor);
  });
}

function watchTextScale(percent: number) {
  scaleObserver?.disconnect();
  scaleObserver = null;
  if (percent === 100) return;
  scaleObserver = new MutationObserver(() => {
    if (scaleTimer) window.clearTimeout(scaleTimer);
    scaleTimer = window.setTimeout(() => applyTextScale(percent), 150);
  });
  scaleObserver.observe(document.body, { childList: true, subtree: true });
}

/* ------------------------------------------------------------------ */
/* overlays: reading guide + reading mask                               */
/* ------------------------------------------------------------------ */

let guide: HTMLDivElement | null = null;
let maskTop: HTMLDivElement | null = null;
let maskBottom: HTMLDivElement | null = null;
let pointerBound = false;
let lastY = typeof window === "undefined" ? 0 : window.innerHeight / 2;

function onPointer(e: PointerEvent | MouseEvent) {
  lastY = e.clientY;
  positionOverlays();
}

function positionOverlays() {
  if (guide) guide.style.top = `${lastY - 5}px`;
  if (maskTop && maskBottom) {
    const band = 110;
    const top = Math.max(0, lastY - band / 2);
    maskTop.style.height = `${top}px`;
    maskBottom.style.height = `${Math.max(0, window.innerHeight - top - band)}px`;
  }
}

function bindPointer(on: boolean) {
  if (on && !pointerBound) {
    document.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("resize", positionOverlays);
    pointerBound = true;
  } else if (!on && pointerBound) {
    document.removeEventListener("pointermove", onPointer);
    window.removeEventListener("resize", positionOverlays);
    pointerBound = false;
  }
}

function applyOverlays(settings: Settings) {
  if (settings.readingGuide && !guide) {
    guide = document.createElement("div");
    guide.className = "sb-a11y sb-a11y-guide";
    guide.setAttribute("aria-hidden", "true");
    document.body.appendChild(guide);
  } else if (!settings.readingGuide && guide) {
    guide.remove();
    guide = null;
  }
  if (settings.readingMask && !maskTop) {
    maskTop = document.createElement("div");
    maskTop.className = "sb-a11y sb-a11y-mask top";
    maskBottom = document.createElement("div");
    maskBottom.className = "sb-a11y sb-a11y-mask bottom";
    for (const el of [maskTop, maskBottom]) {
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
  } else if (!settings.readingMask && maskTop) {
    maskTop.remove();
    maskBottom?.remove();
    maskTop = maskBottom = null;
  }
  bindPointer(Boolean(guide || maskTop));
  positionOverlays();
}

/* ------------------------------------------------------------------ */
/* media: stop animations / mute                                        */
/* ------------------------------------------------------------------ */

let mediaObserver: MutationObserver | null = null;

function applyMedia(settings: Settings) {
  const media = document.querySelectorAll<HTMLMediaElement>("video, audio");
  media.forEach((el) => {
    if (el.closest(WIDGET)) return;
    if (settings.muteSounds) {
      if (!el.hasAttribute("data-sb-a11y-muted")) {
        el.setAttribute("data-sb-a11y-muted", el.muted ? "1" : "0");
        el.muted = true;
      }
    } else if (el.hasAttribute("data-sb-a11y-muted")) {
      el.muted = el.getAttribute("data-sb-a11y-muted") === "1";
      el.removeAttribute("data-sb-a11y-muted");
    }
    if (settings.stopAnimations) {
      if (!el.paused && el.tagName === "VIDEO") {
        el.setAttribute("data-sb-a11y-paused", "1");
        el.pause();
      }
      el.removeAttribute("autoplay");
    } else if (el.getAttribute("data-sb-a11y-paused") === "1") {
      el.removeAttribute("data-sb-a11y-paused");
      el.play().catch(() => undefined);
    }
  });
  effectsBridge()?.setReducedMotion?.(settings.stopAnimations);

  const needWatch = settings.muteSounds || settings.stopAnimations;
  if (needWatch && !mediaObserver) {
    mediaObserver = new MutationObserver((records) => {
      if (records.some((r) => Array.from(r.addedNodes).some((n) => n.nodeType === 1))) applyMedia(currentSettings);
    });
    mediaObserver.observe(document.body, { childList: true, subtree: true });
  } else if (!needWatch && mediaObserver) {
    mediaObserver.disconnect();
    mediaObserver = null;
  }
}

/* ------------------------------------------------------------------ */
/* main entry                                                           */
/* ------------------------------------------------------------------ */

let currentSettings: Settings;

export function applySettings(settings: Settings): void {
  if (typeof document === "undefined") return;
  currentSettings = settings;
  const root = document.documentElement;
  const active =
    settings.fontSize !== 100 ||
    settings.lineHeight !== 0 ||
    settings.letterSpacing !== 0 ||
    settings.textAlign !== "" ||
    settings.font !== "" ||
    settings.contrast !== "" ||
    settings.hideImages;
  setClass(root, "sb-a11y-active", active);

  setChoice(root, "sb-a11y-font-", ["readable", "dyslexic"], settings.font);
  setChoice(root, "sb-a11y-lh-", ["1", "2", "3"], settings.lineHeight ? String(settings.lineHeight) : "");
  setChoice(root, "sb-a11y-ls-", ["1", "2", "3"], settings.letterSpacing ? String(settings.letterSpacing) : "");
  setChoice(root, "sb-a11y-align-", ["left", "center", "right"], settings.textAlign);
  setClass(root, "sb-a11y-titles", settings.highlightTitles);
  setClass(root, "sb-a11y-links", settings.highlightLinks);
  setClass(root, "sb-a11y-focus", settings.focusHighlight);
  setChoice(root, "sb-a11y-contrast-", ["high", "dark", "light"], settings.contrast);
  setClass(root, "sb-a11y-mono", settings.monochrome);
  setChoice(root, "sb-a11y-sat-", ["low", "high"], settings.saturation);
  setClass(root, "sb-a11y-invert", settings.invert);
  setClass(root, "sb-a11y-cursor", settings.bigCursor);
  setClass(root, "sb-a11y-no-motion", settings.stopAnimations);
  setClass(root, "sb-a11y-no-images", settings.hideImages);

  applyTextScale(settings.fontSize);
  watchTextScale(settings.fontSize);
  applyOverlays(settings);
  applyMedia(settings);
}

/* ------------------------------------------------------------------ */
/* page structure                                                       */
/* ------------------------------------------------------------------ */

export type StructureItem = { label: string; level?: number; el: HTMLElement };

function text(el: Element): string {
  return (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90);
}

export function pageStructure(): { headings: StructureItem[]; landmarks: StructureItem[]; links: StructureItem[] } {
  const skip = (el: Element) => Boolean(el.closest(WIDGET));
  const headings: StructureItem[] = [];
  document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,[role='heading']").forEach((el) => {
    if (skip(el)) return;
    const level = Number(el.getAttribute("aria-level")) || Number(el.tagName.slice(1)) || 2;
    const label = text(el);
    if (label) headings.push({ label, level, el });
  });
  const landmarks: StructureItem[] = [];
  const roleNames: Record<string, string> = {
    HEADER: "banner",
    NAV: "navigation",
    MAIN: "main",
    FOOTER: "contentinfo",
    ASIDE: "complementary",
    FORM: "form",
    SECTION: "region",
  };
  document
    .querySelectorAll<HTMLElement>("header,nav,main,footer,aside,form,section[aria-label],section[aria-labelledby],[role='banner'],[role='navigation'],[role='main'],[role='contentinfo'],[role='complementary'],[role='search'],[role='region'],[role='form']")
    .forEach((el) => {
      if (skip(el)) return;
      const role = el.getAttribute("role") || roleNames[el.tagName] || "region";
      const name = el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") ? text(document.getElementById(el.getAttribute("aria-labelledby")!) || el) : "");
      landmarks.push({ label: name ? `${role}: ${name}` : role, el });
    });
  const links: StructureItem[] = [];
  document.querySelectorAll<HTMLElement>("a[href]").forEach((el) => {
    if (skip(el)) return;
    const label = text(el) || el.querySelector("img")?.getAttribute("alt") || "";
    if (label) links.push({ label, el });
  });
  return { headings, landmarks, links: links.slice(0, 200) };
}

export function jumpTo(el: HTMLElement): void {
  el.scrollIntoView({ block: "center", behavior: "auto" });
  const hadTabindex = el.hasAttribute("tabindex");
  if (!hadTabindex) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
  if (!hadTabindex) {
    el.addEventListener("blur", () => el.removeAttribute("tabindex"), { once: true });
  }
}
