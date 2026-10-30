// Clone-time normalisation of animation / interaction intents.
//
// The cloner strips every <script>, so libraries such as AOS, WOW, Animate.css,
// Swiper, Slick, Owl and Elementor's own motion code never run in the replica.
// The snapshot still carries their *intent* (data attributes, class names,
// JSON settings) plus whatever *state* they left behind (duplicate slides,
// inline transforms, "animated" / "elementor-invisible" classes).
//
// This module rewrites that into a neutral `data-sb-*` vocabulary that the
// dependency-free runtime in templates/generated/public/sb-effects.js replays:
//
//   data-sb-anim="fadeInUp" data-sb-delay="200" data-sb-duration="800"
//   data-sb-slider='{"autoplay":3000,"loop":true,"perView":3,...}'
//       + data-sb-track / data-sb-slide / data-sb-prev / data-sb-next / data-sb-dots
//   data-sb-counter="1200" data-sb-counter-duration="2000"
//   data-sb-parallax="0.4"
//   data-sb-toggle="#target" data-sb-toggle-class="open"
import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";

type El = Element;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function classList($: CheerioAPI, el: El): string[] {
  return ($(el).attr("class") || "").split(/\s+/).filter(Boolean);
}

function setClasses($: CheerioAPI, el: El, classes: string[]) {
  if (classes.length) $(el).attr("class", classes.join(" "));
  else $(el).removeAttr("class");
}

function removeClasses($: CheerioAPI, el: El, predicate: (name: string) => boolean) {
  setClasses(
    $,
    el,
    classList($, el).filter((name) => !predicate(name)),
  );
}

function parseJsonAttr($: CheerioAPI, el: El, attr: string): Record<string, unknown> | null {
  const raw = $(el).attr(attr);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** "0.3s" | "300ms" | "300" | 0.3 -> milliseconds */
function toMs(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return value < 20 ? Math.round(value * 1000) : Math.round(value);
  const text = String(value).trim();
  const match = text.match(/^(-?\d*\.?\d+)\s*(ms|s)?$/i);
  if (!match) return null;
  const n = parseFloat(match[1]);
  if (match[2]?.toLowerCase() === "s") return Math.round(n * 1000);
  if (match[2]) return Math.round(n);
  return n < 20 ? Math.round(n * 1000) : Math.round(n);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (value && typeof value === "object" && "size" in value) {
    return num((value as { size: unknown }).size);
  }
  return null;
}

function yes(value: unknown): boolean {
  return value === true || value === "yes" || value === "true" || value === 1 || value === "1";
}

/** Strip selected declarations from an inline style attribute. */
function stripInlineProps($: CheerioAPI, el: El, props: RegExp) {
  const style = $(el).attr("style");
  if (!style) return;
  const kept = style
    .split(";")
    .map((decl) => decl.trim())
    .filter((decl) => decl && !props.test(decl.split(":")[0].trim().toLowerCase()));
  if (kept.length) $(el).attr("style", kept.join("; "));
  else $(el).removeAttr("style");
}

function inlineProp($: CheerioAPI, el: El, prop: string): string | null {
  const style = $(el).attr("style");
  if (!style) return null;
  for (const decl of style.split(";")) {
    const [name, ...rest] = decl.split(":");
    if (name?.trim().toLowerCase() === prop) return rest.join(":").trim();
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* animation name normalisation                                        */
/* ------------------------------------------------------------------ */

/** AOS / sal style names -> Animate.css style names used by the runtime. */
const DIRECTIONAL: Record<string, string> = {
  fade: "fadeIn",
  "fade-up": "fadeInUp",
  "fade-down": "fadeInDown",
  "fade-left": "fadeInRight",
  "fade-right": "fadeInLeft",
  "fade-up-right": "fadeInLeft",
  "fade-up-left": "fadeInRight",
  "fade-down-right": "fadeInLeft",
  "fade-down-left": "fadeInRight",
  "flip-up": "flipInX",
  "flip-down": "flipInX",
  "flip-left": "flipInY",
  "flip-right": "flipInY",
  "slide-up": "slideInUp",
  "slide-down": "slideInDown",
  "slide-left": "slideInRight",
  "slide-right": "slideInLeft",
  "zoom-in": "zoomIn",
  "zoom-in-up": "zoomInUp",
  "zoom-in-down": "zoomInDown",
  "zoom-in-left": "zoomInRight",
  "zoom-in-right": "zoomInLeft",
  "zoom-out": "zoomOut",
  "zoom-out-up": "zoomOut",
  "zoom-out-down": "zoomOut",
  "zoom-out-left": "zoomOut",
  "zoom-out-right": "zoomOut",
};

/** Animate.css names the runtime ships keyframes for. */
export const KNOWN_ANIMATIONS = new Set([
  "fadeIn",
  "fadeInUp",
  "fadeInDown",
  "fadeInLeft",
  "fadeInRight",
  "fadeInUpBig",
  "fadeInDownBig",
  "fadeInLeftBig",
  "fadeInRightBig",
  "zoomIn",
  "zoomInUp",
  "zoomInDown",
  "zoomInLeft",
  "zoomInRight",
  "zoomOut",
  "slideInUp",
  "slideInDown",
  "slideInLeft",
  "slideInRight",
  "bounceIn",
  "bounceInUp",
  "bounceInDown",
  "bounceInLeft",
  "bounceInRight",
  "flipInX",
  "flipInY",
  "rotateIn",
  "rotateInDownLeft",
  "rotateInDownRight",
  "rotateInUpLeft",
  "rotateInUpRight",
  "lightSpeedInRight",
  "lightSpeedInLeft",
  "rollIn",
  "bounce",
  "pulse",
  "flash",
  "rubberBand",
  "shake",
  "swing",
  "tada",
  "wobble",
  "jello",
  "heartBeat",
]);

const STATE_CLASSES = new Set([
  "aos-init",
  "aos-animate",
  "animated",
  "animate__animated",
  "wow",
  "elementor-invisible",
  "sal-animate",
  "animate",
  "animated-slow",
  "animated-fast",
]);

export function normalizeAnimationName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = String(raw).trim();
  if (!name || name === "none") return null;
  name = name.replace(/^animate__/, "").replace(/^animated\s+/, "");
  if (DIRECTIONAL[name]) return DIRECTIONAL[name];
  if (KNOWN_ANIMATIONS.has(name)) return name;
  // camelCase variants of hyphenated names, e.g. "fade-in-up"
  const camel = name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  if (KNOWN_ANIMATIONS.has(camel)) return camel;
  if (/fade/i.test(name)) return "fadeIn";
  if (/zoom|scale/i.test(name)) return "zoomIn";
  if (/slide/i.test(name)) return "slideInUp";
  if (/flip/i.test(name)) return "flipInX";
  if (/bounce/i.test(name)) return "bounceIn";
  if (/rotate/i.test(name)) return "rotateIn";
  return "fadeIn";
}

/* ------------------------------------------------------------------ */
/* entrance animations                                                 */
/* ------------------------------------------------------------------ */

function tagAnimation(
  $: CheerioAPI,
  el: El,
  name: string | null,
  delay: number | null,
  duration: number | null,
) {
  if (!name) return;
  if ($(el).attr("data-sb-anim")) return;
  $(el).attr("data-sb-anim", name);
  if (delay && delay > 0) $(el).attr("data-sb-delay", String(delay));
  if (duration && duration > 0) $(el).attr("data-sb-duration", String(duration));
  // Whatever the library left behind: hidden / half-animated inline styles.
  stripInlineProps(
    $,
    el,
    /^(animation|animation-[a-z-]+|visibility|--animate-[a-z-]+|opacity|transform|will-change)$/,
  );
}

function extractEntranceAnimations($: CheerioAPI) {
  // AOS
  $("[data-aos]").each((_, node) => {
    const el = node as El;
    const name = normalizeAnimationName($(el).attr("data-aos"));
    tagAnimation(
      $,
      el,
      name,
      toMs($(el).attr("data-aos-delay")),
      toMs($(el).attr("data-aos-duration")),
    );
    for (const attr of Object.keys(el.attribs)) {
      if (attr.startsWith("data-aos")) $(el).removeAttr(attr);
    }
  });

  // sal.js
  $("[data-sal]").each((_, node) => {
    const el = node as El;
    tagAnimation(
      $,
      el,
      normalizeAnimationName($(el).attr("data-sal")),
      toMs($(el).attr("data-sal-delay")),
      toMs($(el).attr("data-sal-duration")),
    );
    for (const attr of Object.keys(el.attribs)) {
      if (attr.startsWith("data-sal")) $(el).removeAttr(attr);
    }
  });

  // Elementor: settings JSON on sections / columns / widgets
  $("[data-settings]").each((_, node) => {
    const el = node as El;
    const settings = parseJsonAttr($, el, "data-settings");
    if (!settings) return;
    const raw =
      (settings._animation as string | undefined) ||
      (settings.animation as string | undefined) ||
      (settings._animation_tablet as string | undefined) ||
      (settings._animation_mobile as string | undefined) ||
      (settings.animation_tablet as string | undefined) ||
      (settings.animation_mobile as string | undefined);
    const classes = classList($, el);
    const hasInvisible = classes.includes("elementor-invisible");
    if (!raw && !hasInvisible) return;
    const delay = toMs(settings._animation_delay ?? settings.animation_delay);
    const durationWord =
      (settings._animation_duration as string | undefined) ||
      (settings.animation_duration as string | undefined);
    const duration =
      durationWord === "slow" || classes.includes("animated-slow")
        ? 2000
        : durationWord === "fast" || classes.includes("animated-fast")
          ? 800
          : null;
    let name = normalizeAnimationName(raw);
    if (!name) {
      // Only the class survived — pick the animate.css class if present.
      const fromClass = classes.find((c) => KNOWN_ANIMATIONS.has(c));
      name = fromClass || "fadeIn";
    }
    tagAnimation($, el, name, delay, duration);
  });

  // WOW.js
  $(".wow").each((_, node) => {
    const el = node as El;
    const classes = classList($, el);
    const fromClass = classes.find((c) => KNOWN_ANIMATIONS.has(c) || /^(fade|zoom|slide|bounce|flip|rotate)/i.test(c) && c !== "wow");
    tagAnimation(
      $,
      el,
      normalizeAnimationName(fromClass || "fadeIn"),
      toMs($(el).attr("data-wow-delay")),
      toMs($(el).attr("data-wow-duration")),
    );
    for (const attr of Object.keys(el.attribs)) {
      if (attr.startsWith("data-wow")) $(el).removeAttr(attr);
    }
  });

  // Animate.css v4 (animate__animated animate__fadeInUp animate__delay-1s)
  $(".animate__animated").each((_, node) => {
    const el = node as El;
    const classes = classList($, el);
    const anim = classes.find((c) => c.startsWith("animate__") && c !== "animate__animated" && !/^animate__(delay|faster|fast|slow|slower|repeat|infinite)/.test(c));
    const delayClass = classes.find((c) => /^animate__delay-(\d+)s$/.test(c));
    const delay = delayClass ? toMs(delayClass.replace("animate__delay-", "")) : null;
    const speed = classes.includes("animate__slower")
      ? 3000
      : classes.includes("animate__slow")
        ? 2000
        : classes.includes("animate__fast")
          ? 800
          : classes.includes("animate__faster")
            ? 500
            : null;
    tagAnimation($, el, normalizeAnimationName(anim || "fadeIn"), delay, speed);
    removeClasses($, el, (c) => c.startsWith("animate__"));
  });

  // Legacy "animated fadeInUp" (Animate.css v3 without a trigger library)
  $(".animated").each((_, node) => {
    const el = node as El;
    if ($(el).attr("data-sb-anim")) return;
    const classes = classList($, el);
    const anim = classes.find((c) => KNOWN_ANIMATIONS.has(c));
    if (anim) tagAnimation($, el, anim, null, null);
  });

  // GSAP-style leftovers: inline opacity:0 + transform means a reveal never
  // finished before the snapshot. Turn it into a fade so it isn't lost.
  $('[style*="opacity"]').each((_, node) => {
    const el = node as El;
    if ($(el).attr("data-sb-anim")) return;
    const opacity = inlineProp($, el, "opacity");
    const transform = inlineProp($, el, "transform");
    if (opacity === "0" && transform && /translate|scale/i.test(transform)) {
      tagAnimation($, el, /translate/i.test(transform) ? "fadeInUp" : "zoomIn", null, null);
    }
  });

  // Finally drop library state classes everywhere they appear.
  $("[data-sb-anim]").each((_, node) => {
    const el = node as El;
    removeClasses(
      $,
      el,
      (c) => STATE_CLASSES.has(c) || KNOWN_ANIMATIONS.has(c) || c.startsWith("animate__"),
    );
  });
  $(".elementor-invisible, .aos-init, .aos-animate").each((_, node) => {
    removeClasses($, node as El, (c) => STATE_CLASSES.has(c));
  });
}

/* ------------------------------------------------------------------ */
/* sliders / carousels                                                 */
/* ------------------------------------------------------------------ */

type SliderOptions = {
  autoplay: number; // ms, 0 = off
  loop: boolean;
  perView: number;
  perViewTablet: number;
  perViewMobile: number;
  gap: number; // px
  speed: number; // ms
  effect: "slide" | "fade";
  pauseOnHover: boolean;
};

function defaultSlider(): SliderOptions {
  return {
    autoplay: 0,
    loop: true,
    perView: 1,
    perViewTablet: 0, // 0 = derive from perView in finishSlider
    perViewMobile: 0,
    gap: 0,
    speed: 500,
    effect: "slide",
    pauseOnHover: true,
  };
}

function closestSettings($: CheerioAPI, el: El): Record<string, unknown> | null {
  let cursor: AnyNode | null = el;
  for (let depth = 0; cursor && depth < 6; depth++) {
    if (cursor.type === "tag") {
      const parsed = parseJsonAttr($, cursor as El, "data-settings");
      if (parsed) return parsed;
    }
    cursor = cursor.parent;
  }
  return null;
}

function elementorSliderOptions(settings: Record<string, unknown> | null): Partial<SliderOptions> {
  if (!settings) return {};
  const out: Partial<SliderOptions> = {};
  if (yes(settings.autoplay)) out.autoplay = num(settings.autoplay_speed) ?? 5000;
  if ("infinite" in settings) out.loop = yes(settings.infinite);
  if ("loop" in settings) out.loop = yes(settings.loop);
  const perView = num(settings.slides_to_show) ?? num(settings.columns) ?? num(settings.slides_per_view);
  if (perView) out.perView = perView;
  const tablet = num(settings.slides_to_show_tablet) ?? num(settings.columns_tablet) ?? num(settings.slides_per_view_tablet);
  if (tablet) out.perViewTablet = tablet;
  const mobile = num(settings.slides_to_show_mobile) ?? num(settings.columns_mobile) ?? num(settings.slides_per_view_mobile);
  if (mobile) out.perViewMobile = mobile;
  const speed = num(settings.speed) ?? num(settings.transition_speed);
  if (speed) out.speed = speed;
  const gap = num(settings.image_spacing_custom) ?? num(settings.space_between);
  if (gap) out.gap = gap;
  if (settings.effect === "fade" || settings.transition === "fade") out.effect = "fade";
  if ("pause_on_hover" in settings) out.pauseOnHover = yes(settings.pause_on_hover);
  return out;
}

function slickOptions(settings: Record<string, unknown> | null): Partial<SliderOptions> {
  if (!settings) return {};
  const out: Partial<SliderOptions> = {};
  if (yes(settings.autoplay)) out.autoplay = num(settings.autoplaySpeed) ?? 3000;
  if ("infinite" in settings) out.loop = yes(settings.infinite);
  const perView = num(settings.slidesToShow);
  if (perView) out.perView = perView;
  const speed = num(settings.speed);
  if (speed) out.speed = speed;
  if (yes(settings.fade)) out.effect = "fade";
  if ("pauseOnHover" in settings) out.pauseOnHover = yes(settings.pauseOnHover);
  const responsive = settings.responsive;
  if (Array.isArray(responsive)) {
    for (const entry of responsive as Array<{ breakpoint?: number; settings?: Record<string, unknown> }>) {
      const bp = num(entry.breakpoint);
      const n = num(entry.settings?.slidesToShow);
      if (!bp || !n) continue;
      if (bp <= 800) out.perViewMobile = n;
      else if (bp <= 1100) out.perViewTablet = n;
    }
  }
  return out;
}

function owlOptions($: CheerioAPI, el: El): Partial<SliderOptions> {
  const raw = $(el).attr("data-owl-options") || $(el).attr("data-options") || $(el).attr("data-carousel-options");
  let settings: Record<string, unknown> | null = null;
  if (raw) {
    try {
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      settings = null;
    }
  }
  const out: Partial<SliderOptions> = {};
  if (!settings) return out;
  if (yes(settings.autoplay)) out.autoplay = num(settings.autoplayTimeout) ?? 5000;
  if ("loop" in settings) out.loop = yes(settings.loop);
  const items = num(settings.items);
  if (items) out.perView = items;
  const margin = num(settings.margin);
  if (margin) out.gap = margin;
  const speed = num(settings.smartSpeed);
  if (speed) out.speed = speed;
  return out;
}

function finishSlider(
  $: CheerioAPI,
  container: El,
  track: El,
  slides: El[],
  options: SliderOptions,
  nav: { prev?: El; next?: El; dots?: El },
  viewport?: El,
) {
  if (slides.length < 2) return;
  if (!options.perView || options.perView < 1) options.perView = 1;
  if (!options.perViewTablet || options.perViewTablet > options.perView) {
    options.perViewTablet = Math.min(options.perView, 2);
  }
  if (!options.perViewMobile || options.perViewMobile > options.perViewTablet) {
    options.perViewMobile = 1;
  }
  $(container).attr("data-sb-slider", JSON.stringify(options));
  $(track).attr("data-sb-track", "");
  stripInlineProps($, track, /^(transform|transition|transition-duration|width|height|left|opacity)$/);
  for (const slide of slides) {
    $(slide).attr("data-sb-slide", "");
    stripInlineProps($, slide, /^(width|margin-right|margin-left|transform|transition|transition-duration|opacity|left|position|z-index|visibility|height)$/);
  }
  if (viewport) $(viewport).attr("data-sb-viewport", "");
  if (nav.prev) $(nav.prev).attr("data-sb-prev", "");
  if (nav.next) $(nav.next).attr("data-sb-next", "");
  if (nav.dots) {
    $(nav.dots).attr("data-sb-dots", "");
    $(nav.dots).empty();
  }
}

function findNav($: CheerioAPI, container: El, selectors: { prev: string; next: string; dots: string }) {
  // Navigation usually sits inside the slider or in its closest widget wrapper.
  const scopes: El[] = [container];
  let parent = container.parent;
  for (let depth = 0; parent && depth < 3; depth++) {
    if (parent.type === "tag") scopes.push(parent as El);
    parent = parent.parent;
  }
  const pick = (selector: string): El | undefined => {
    for (const scope of scopes) {
      const found = $(scope).find(selector).first();
      if (found.length) return found.get(0) as El;
    }
    return undefined;
  };
  return { prev: pick(selectors.prev), next: pick(selectors.next), dots: pick(selectors.dots) };
}

function extractSliders($: CheerioAPI) {
  // Swiper (also used by Elementor carousels / slides / testimonials)
  $(".swiper, .swiper-container").each((_, node) => {
    const container = node as El;
    if ($(container).attr("data-sb-slider")) return;
    const track = $(container).children(".swiper-wrapper").first().get(0) as El | undefined;
    if (!track) return;
    $(track).children(".swiper-slide-duplicate").remove();
    const slides = $(track).children(".swiper-slide").toArray() as El[];
    const settings = closestSettings($, container);
    const options: SliderOptions = { ...defaultSlider(), ...elementorSliderOptions(settings) };
    if (classList($, container).includes("swiper-fade")) options.effect = "fade";
    const nav = findNav($, container, {
      prev: ".swiper-button-prev, .elementor-swiper-button-prev",
      next: ".swiper-button-next, .elementor-swiper-button-next",
      dots: ".swiper-pagination",
    });
    removeClasses($, container, (c) => /^swiper-(initialized|horizontal|vertical|backface-hidden|watch-progress|autoheight|css-mode|pointer-events|android|ios)$/.test(c));
    for (const slide of slides) {
      removeClasses($, slide, (c) => /^swiper-slide-(active|next|prev|visible|fully-visible|duplicate.*)$/.test(c));
    }
    finishSlider($, container, track, slides, options, nav, container);
  });

  // Slick
  $(".slick-slider, .slick-initialized").each((_, node) => {
    const container = node as El;
    if ($(container).attr("data-sb-slider")) return;
    const list = $(container).find(".slick-list").first().get(0) as El | undefined;
    const track = $(container).find(".slick-track").first().get(0) as El | undefined;
    if (!track) return;
    $(track).children(".slick-cloned").remove();
    const slides = $(track).children(".slick-slide").toArray() as El[];
    const options: SliderOptions = {
      ...defaultSlider(),
      ...slickOptions(parseJsonAttr($, container, "data-slick")),
    };
    const nav = findNav($, container, {
      prev: ".slick-prev",
      next: ".slick-next",
      dots: ".slick-dots",
    });
    removeClasses($, container, (c) => /^slick-(initialized|dotted)$/.test(c));
    for (const slide of slides) {
      removeClasses($, slide, (c) => /^slick-(active|current|center)$/.test(c));
      $(slide).removeAttr("aria-hidden").removeAttr("tabindex");
    }
    if (list) stripInlineProps($, list, /^(height|padding|transform)$/);
    finishSlider($, container, track, slides, options, nav, list ?? track);
  });

  // Owl carousel
  $(".owl-carousel").each((_, node) => {
    const container = node as El;
    if ($(container).attr("data-sb-slider")) return;
    const outer = $(container).find(".owl-stage-outer").first().get(0) as El | undefined;
    const track = $(container).find(".owl-stage").first().get(0) as El | undefined;
    if (!track) return;
    $(track).children(".owl-item.cloned").remove();
    const slides = $(track).children(".owl-item").toArray() as El[];
    const options: SliderOptions = { ...defaultSlider(), ...owlOptions($, container) };
    const nav = findNav($, container, {
      prev: ".owl-prev",
      next: ".owl-next",
      dots: ".owl-dots",
    });
    for (const slide of slides) removeClasses($, slide, (c) => /^(active|center)$/.test(c));
    finishSlider($, container, track, slides, options, nav, outer ?? track);
  });

  // Bootstrap carousel: keep the markup, runtime toggles .active
  $(".carousel").each((_, node) => {
    const container = node as El;
    if ($(container).attr("data-sb-slider")) return;
    const inner = $(container).find(".carousel-inner").first().get(0) as El | undefined;
    if (!inner) return;
    const slides = $(inner).children(".carousel-item").toArray() as El[];
    if (slides.length < 2) return;
    const interval = num($(container).attr("data-bs-interval") ?? $(container).attr("data-interval"));
    const options: SliderOptions = {
      ...defaultSlider(),
      effect: "fade",
      autoplay: interval === 0 ? 0 : interval ?? 5000,
    };
    const nav = findNav($, container, {
      prev: ".carousel-control-prev",
      next: ".carousel-control-next",
      dots: ".carousel-indicators",
    });
    $(container).attr("data-sb-slider-mode", "class");
    finishSlider($, container, inner, slides, options, nav, inner);
  });
}

/* ------------------------------------------------------------------ */
/* counters                                                            */
/* ------------------------------------------------------------------ */

function extractCounters($: CheerioAPI) {
  const rules: Array<{ selector: string; to: string[]; from?: string[]; duration?: string[] }> = [
    { selector: ".elementor-counter-number", to: ["data-to-value"], from: ["data-from-value"], duration: ["data-duration"] },
    { selector: "[data-purecounter-end]", to: ["data-purecounter-end"], from: ["data-purecounter-start"], duration: ["data-purecounter-duration"] },
    { selector: "[data-count]", to: ["data-count"], duration: ["data-speed", "data-duration"] },
    { selector: "[data-counter]", to: ["data-counter"], duration: ["data-speed", "data-duration"] },
    { selector: ".counter[data-target], .count[data-target], .counter-value[data-target]", to: ["data-target"], duration: ["data-speed", "data-duration"] },
    { selector: ".counter[data-to], .count[data-to], .odometer[data-count]", to: ["data-to", "data-count"] },
    { selector: ".counter-number[data-number], .stat-number[data-number]", to: ["data-number"] },
  ];
  for (const rule of rules) {
    $(rule.selector).each((_, node) => {
      const el = node as El;
      if ($(el).attr("data-sb-counter") !== undefined) return;
      const to = rule.to.map((attr) => $(el).attr(attr)).find((v) => v !== undefined && v !== "");
      if (to === undefined) return;
      const target = String(to).replace(/[^\d.-]/g, "");
      if (!target || !Number.isFinite(Number(target))) return;
      $(el).attr("data-sb-counter", target);
      const from = rule.from?.map((attr) => $(el).attr(attr)).find((v) => v !== undefined && v !== "");
      if (from !== undefined) $(el).attr("data-sb-counter-from", String(from).replace(/[^\d.-]/g, "") || "0");
      const duration = rule.duration?.map((attr) => $(el).attr(attr)).find((v) => v !== undefined && v !== "");
      const ms = duration !== undefined ? toMs(duration) : null;
      if (ms && ms > 0) $(el).attr("data-sb-counter-duration", String(ms));
    });
  }
}

/* ------------------------------------------------------------------ */
/* parallax (Elementor motion effects)                                 */
/* ------------------------------------------------------------------ */

function extractParallax($: CheerioAPI) {
  $("[data-settings]").each((_, node) => {
    const el = node as El;
    const settings = parseJsonAttr($, el, "data-settings");
    if (!settings) return;
    if (yes(settings.motion_fx_motion_fx_scrolling) && yes(settings.motion_fx_translateY_effect)) {
      const speed = num(settings.motion_fx_translateY_speed) ?? 4;
      const direction = settings.motion_fx_translateY_direction === "negative" ? -1 : 1;
      $(el).attr("data-sb-parallax", String((speed / 10) * direction));
    }
    if (yes(settings.background_motion_fx_motion_fx_scrolling) && yes(settings.background_motion_fx_translateY_effect)) {
      const speed = num(settings.background_motion_fx_translateY_speed) ?? 4;
      $(el).attr("data-sb-parallax-bg", String(speed / 10));
    }
  });
  // jarallax / rellax style attributes
  $("[data-rellax-speed]").each((_, node) => {
    const el = node as El;
    const speed = num($(el).attr("data-rellax-speed"));
    if (speed !== null) $(el).attr("data-sb-parallax", String(speed / 10));
  });
  $("[data-jarallax], .jarallax").each((_, node) => {
    const el = node as El;
    const speed = num($(el).attr("data-speed")) ?? 0.5;
    $(el).attr("data-sb-parallax-bg", String(Math.max(0.1, Math.min(1, 1 - speed))));
  });
}

/* ------------------------------------------------------------------ */
/* toggles (mobile menus etc.)                                         */
/* ------------------------------------------------------------------ */

function extractToggles($: CheerioAPI) {
  // Generic hamburger buttons that point at their panel.
  $("button[aria-controls], a[aria-controls], [data-bs-toggle='collapse'], [data-toggle='collapse']").each((_, node) => {
    const el = node as El;
    if ($(el).attr("data-sb-toggle")) return;
    const target =
      $(el).attr("data-bs-target") ||
      $(el).attr("data-target") ||
      ($(el).attr("aria-controls") ? `#${$(el).attr("aria-controls")}` : "") ||
      ($(el).attr("href")?.startsWith("#") ? $(el).attr("href") : "");
    if (!target || target === "#") return;
    // Skip tab / accordion controls; the runtime handles those by pattern.
    if (/tab|accordion/i.test($(el).attr("role") || "") || $(el).attr("data-bs-toggle") === "tab") return;
    $(el).attr("data-sb-toggle", target);
    const isCollapse = $(el).attr("data-bs-toggle") === "collapse" || $(el).attr("data-toggle") === "collapse";
    $(el).attr("data-sb-toggle-class", isCollapse ? "show" : "sb-open");
  });
  // Common class-based menu buttons without aria-controls.
  $(".menu-toggle, .navbar-toggle, .mobile-menu-toggle, .hamburger, .menu-btn, .nav-toggle").each((_, node) => {
    const el = node as El;
    if ($(el).attr("data-sb-toggle") || classList($, el).includes("elementor-menu-toggle")) return;
    const parent = el.parent && el.parent.type === "tag" ? (el.parent as El) : null;
    if (!parent) return;
    const panel = $(parent).find("nav, ul, .menu, .nav-menu, .navbar-collapse").first();
    if (!panel.length) return;
    const id = $(panel).attr("id") || `sb-menu-${Math.random().toString(36).slice(2, 8)}`;
    $(panel).attr("id", id);
    $(el).attr("data-sb-toggle", `#${id}`).attr("data-sb-toggle-class", "sb-open");
  });
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

/** Mutates the document in place. Safe to call on documents with no effects. */
export function extractEffects($: CheerioAPI): void {
  extractSliders($);
  extractEntranceAnimations($);
  extractCounters($);
  extractParallax($);
  extractToggles($);
}
