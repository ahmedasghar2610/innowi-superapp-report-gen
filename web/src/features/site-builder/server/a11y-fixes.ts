// Clone-time WCAG 2.1 AA fixes applied to every cloned page (called from
// rewriteHtml in lib/html-to-next.ts after extractEffects).
//
// Deterministic, conservative repairs only. Anything that needed a guess is
// tagged with data-sb-a11y="<kind>" so the editor's Accessibility panel lists
// it for human review; the marker is removed once the author fixes it.
//
//   alt-guess   img alt derived from title/aria-label/figcaption/filename
//   empty-link  link or button that still has no accessible name
//   no-label    form control that still has no label
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

const DECORATIVE_CLASS_RE = /(^|[-_ ])(icon|decor|decoration|bg|background|spacer|divider|separator|shape|ornament|pattern|overlay)([-_ ]|$)/i;
const DECORATIVE_FILE_RE = /(spacer|pixel|blank|transparent|divider|separator|shape|pattern|bg[-_]?\d*|background)/i;
const GENERIC_FILE_RE = /^(img|image|photo|picture|pic|dsc|dscn|dcim|img_|screenshot|untitled|unnamed|file|download|logo)?[-_]?\d*$/i;

export type A11yFixStats = {
  altDecorative: number;
  altGuessed: number;
  altMissing: number;
  linkNames: number;
  emptyLinks: number;
  labels: number;
  unlabeled: number;
  iframeTitles: number;
  noopener: number;
};

function text($: CheerioAPI, el: Element): string {
  return $(el).text().replace(/\s+/g, " ").trim();
}

/** Accessible-name approximation: aria-label > aria-labelledby > text > child img alt > title. */
function accessibleName($: CheerioAPI, el: Element): string {
  const $el = $(el);
  const aria = ($el.attr("aria-label") || "").trim();
  if (aria) return aria;
  const labelledBy = ($el.attr("aria-labelledby") || "").trim();
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => text($, $(`#${cssEscape(id)}`).get(0) as Element))
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  const own = text($, el);
  if (own) return own;
  const alts = $el
    .find("img[alt], svg[aria-label], [aria-label]")
    .map((_, child) => ($(child).attr("alt") || $(child).attr("aria-label") || "").trim())
    .get()
    .filter(Boolean);
  if (alts.length) return alts.join(" ");
  const svgTitle = $el.find("svg > title").first().text().trim();
  if (svgTitle) return svgTitle;
  return ($el.attr("title") || "").trim();
}

function cssEscape(id: string): string {
  return id.replace(/([^\w-])/g, "\\$1");
}

/** Words from an image filename, or "" when the name is generic (IMG_1234). */
export function wordsFromFilename(src: string): string {
  let file = src.split(/[?#]/)[0].split("/").pop() || "";
  file = decodeURIComponent(file).replace(/\.[a-z0-9]{2,5}$/i, "");
  // Strip WordPress size suffixes (-300x200, @2x, -scaled).
  file = file.replace(/-\d{2,4}x\d{2,4}$/i, "").replace(/@\dx$/i, "").replace(/-scaled$/i, "");
  if (!file || GENERIC_FILE_RE.test(file) || DECORATIVE_FILE_RE.test(file)) return "";
  const words = file
    .replace(/[-_+.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b[0-9a-f]{6,}\b/gi, "")
    .replace(/\b\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (words.length < 3 || !/[a-z]{3,}/i.test(words)) return "";
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function isDecorativeImage($: CheerioAPI, img: Element): boolean {
  const $img = $(img);
  if ($img.attr("role") === "presentation" || $img.attr("role") === "none") return true;
  if ($img.attr("aria-hidden") === "true") return true;
  const cls = $img.attr("class") || "";
  if (DECORATIVE_CLASS_RE.test(cls)) return true;
  const src = $img.attr("src") || $img.attr("data-src") || "";
  if (/^data:image\/(gif|png);base64,(R0lGOD|iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB)/.test(src)) return true; // 1px spacers
  if (DECORATIVE_FILE_RE.test(src.split("/").pop() || "")) return true;
  const w = parseInt($img.attr("width") || "", 10);
  const h = parseInt($img.attr("height") || "", 10);
  if (w > 0 && h > 0 && (w <= 2 || h <= 2)) return true;
  // Image inside a link/button that already has a text label: the text is the name.
  const owner = $img.closest("a, button, [role='button'], [role='link']").get(0) as Element | undefined;
  if (owner) {
    const ownerText = text($, owner);
    if (ownerText.length >= 2 || $(owner).attr("aria-label")) return true;
  }
  return false;
}

function guessAlt($: CheerioAPI, img: Element): string {
  const $img = $(img);
  const direct = ($img.attr("aria-label") || $img.attr("title") || $img.attr("data-alt") || "").trim();
  if (direct) return direct;
  const figure = $img.closest("figure").get(0) as Element | undefined;
  if (figure) {
    const cap = text($, $(figure).find("figcaption").get(0) as Element);
    if (cap) return cap.slice(0, 150);
  }
  // Lightbox / gallery attributes commonly carry a caption or title.
  const galleryTitle = ($img.attr("data-caption") || $img.attr("data-title") || $img.attr("data-elementor-lightbox-title") || $img.attr("data-elementor-lightbox-description") || "").trim();
  if (galleryTitle) return galleryTitle.slice(0, 150);
  const parentA = $img.closest("a").get(0) as Element | undefined;
  if (parentA) {
    const t = ($(parentA).attr("title") || $(parentA).attr("data-elementor-lightbox-title") || "").trim();
    if (t) return t.slice(0, 150);
  }
  return wordsFromFilename($img.attr("src") || $img.attr("data-src") || $img.attr("data-lazy-src") || "");
}

/** Apply the fixes in place. Returns counts for progress/diagnostics. */
export function applyA11yFixes($: CheerioAPI): A11yFixStats {
  const stats: A11yFixStats = {
    altDecorative: 0,
    altGuessed: 0,
    altMissing: 0,
    linkNames: 0,
    emptyLinks: 0,
    labels: 0,
    unlabeled: 0,
    iframeTitles: 0,
    noopener: 0,
  };

  /* --- 1.1.1 images ------------------------------------------------ */
  $("img").each((_, el) => {
    const $img = $(el);
    const alt = $img.attr("alt");
    if (alt !== undefined) {
      // Filename used as alt text is as bad as none.
      const file = ($img.attr("src") || "").split("/").pop()?.split(/[?#]/)[0] || "";
      if (alt.trim() && file && alt.trim().toLowerCase() === file.toLowerCase()) {
        const better = wordsFromFilename(file);
        $img.attr("alt", better);
        $img.attr("data-sb-a11y", "alt-guess");
        stats.altGuessed += 1;
      }
      return;
    }
    if (isDecorativeImage($, el)) {
      $img.attr("alt", "");
      stats.altDecorative += 1;
      return;
    }
    const guess = guessAlt($, el);
    $img.attr("alt", guess);
    $img.attr("data-sb-a11y", "alt-guess");
    if (guess) stats.altGuessed += 1;
    else stats.altMissing += 1;
  });

  /* --- 4.1.2 / 2.4.4 links and buttons need a name ----------------- */
  $("a[href], button, [role='button'], [role='link']").each((_, el) => {
    const $el = $(el);
    if ($el.attr("aria-hidden") === "true" || $el.attr("tabindex") === "-1") return;
    if (accessibleName($, el)) return;
    const title = ($el.attr("title") || "").trim();
    const childAlt = $el.find("img[alt]").first().attr("alt")?.trim() || "";
    const iconClass = ($el.find("i[class*='fa-'], i[class*='icon-'], span[class*='icon-']").first().attr("class") || "").match(/(?:fa|icon)-([a-z0-9-]+)/i)?.[1];
    const href = ($el.attr("href") || "").trim();
    let name = title || childAlt;
    if (!name && iconClass) {
      const social = iconClass.match(/(facebook|instagram|twitter|x-twitter|linkedin|youtube|tiktok|pinterest|whatsapp|telegram|yelp|google|phone|envelope|mail|search|cart|bars|menu|times|close|arrow-(?:left|right|up|down)|chevron-(?:left|right|up|down)|angle-(?:left|right|up|down)|play|pause)/i)?.[1];
      if (social) {
        name = social
          .replace(/^x-twitter$/, "X (Twitter)")
          .replace(/^envelope|mail$/, "Email")
          .replace(/^bars|menu$/, "Menu")
          .replace(/^times|close$/, "Close")
          .replace(/-(left|right|up|down)$/, (_m, dir: string) => ` ${dir}`)
          .replace(/^./, (c) => c.toUpperCase());
      }
    }
    if (!name && href) {
      if (/^mailto:/i.test(href)) name = `Email ${href.slice(7).split("?")[0]}`;
      else if (/^tel:/i.test(href)) name = `Call ${href.slice(4)}`;
      else {
        const host = href.match(/^https?:\/\/(?:www\.)?([^/?#]+)/i)?.[1] || "";
        const brand = host.match(/(facebook|instagram|twitter|x\.com|linkedin|youtube|tiktok|pinterest|yelp|whatsapp|maps\.google|google)/i)?.[1];
        if (brand) name = brand.replace(/^x\.com$/, "X (Twitter)").replace(/^maps\.google$/, "Google Maps").replace(/^./, (c) => c.toUpperCase());
      }
    }
    // Image-only link whose image was marked decorative upstream (alt=""),
    // e.g. a WordPress logo: the image *is* the link text, so give it alt.
    if (!name) {
      const onlyImg = $el.children("img, picture").length === 1 && !text($, el) ? $el.find("img").first() : null;
      if (onlyImg && onlyImg.length) {
        const src = onlyImg.attr("src") || onlyImg.attr("data-src") || "";
        const isHome = href === "/" || /^https?:\/\/[^/?#]+\/?$/i.test(href);
        const guess = wordsFromFilename(src)
          .replace(/\b(header|footer|site|main|nav)\b/gi, "")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/^./, (c) => c.toUpperCase());
        const alt = isHome ? (guess && !/home/i.test(guess) ? `${guess} – Home` : "Home") : guess;
        if (alt) {
          onlyImg.attr("alt", alt);
          onlyImg.removeAttr("role");
          onlyImg.attr("data-sb-a11y", "alt-guess");
          stats.altGuessed += 1;
          stats.linkNames += 1;
          return;
        }
      }
    }
    if (name) {
      $el.attr("aria-label", name);
      stats.linkNames += 1;
    } else {
      $el.attr("data-sb-a11y", "empty-link");
      stats.emptyLinks += 1;
    }
  });

  /* --- 1.3.1 / 3.3.2 form controls need a label ---------------------- */
  let autoId = 0;
  $("input, select, textarea").each((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") || "text").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type)) {
      if (type === "image" && !$el.attr("alt")) $el.attr("alt", ($el.attr("value") || "Submit").trim());
      return;
    }
    if ($el.attr("aria-label") || $el.attr("aria-labelledby") || $el.attr("title")) return;
    const id = $el.attr("id");
    if (id && $(`label[for="${id.replace(/"/g, '\\"')}"]`).length) return;
    if ($el.closest("label").length) return;
    // A sibling/nearby label without `for`: bind it.
    const parent = $el.parent();
    const nearLabel = parent.children("label").not("[for]").first();
    if (nearLabel.length && text($, nearLabel.get(0) as Element)) {
      const newId = id || `sb-field-${++autoId}`;
      $el.attr("id", newId);
      nearLabel.attr("for", newId);
      stats.labels += 1;
      return;
    }
    const placeholder = ($el.attr("placeholder") || $el.attr("name") || "").trim().replace(/[-_]+/g, " ");
    if (placeholder) {
      $el.attr("aria-label", placeholder.replace(/\*+$/, "").trim());
      stats.labels += 1;
    } else {
      $el.attr("data-sb-a11y", "no-label");
      stats.unlabeled += 1;
    }
  });

  /* --- 4.1.2 iframes need a title ----------------------------------- */
  $("iframe").each((_, el) => {
    const $el = $(el);
    if (($el.attr("title") || "").trim()) return;
    const src = $el.attr("src") || $el.attr("data-src") || "";
    let host = "";
    try {
      host = new URL(src, "https://example.invalid").hostname.replace(/^www\./, "");
    } catch {
      host = "";
    }
    const known: Array<[RegExp, string]> = [
      [/youtube|youtu\.be/, "YouTube video"],
      [/vimeo/, "Vimeo video"],
      [/google\.[a-z.]+\/maps|maps\.google/, "Google Maps"],
      [/facebook/, "Facebook content"],
      [/instagram/, "Instagram content"],
      [/spotify/, "Spotify player"],
      [/soundcloud/, "SoundCloud player"],
      [/calendly/, "Calendly scheduling"],
      [/recaptcha/, "reCAPTCHA"],
    ];
    const label = known.find(([re]) => re.test(src))?.[1] || (host && host !== "example.invalid" ? `Embedded content from ${host}` : "Embedded content");
    $el.attr("title", label);
    stats.iframeTitles += 1;
  });

  /* --- security + 3.2.5: new-window links --------------------------- */
  $("a[target='_blank']").each((_, el) => {
    const $el = $(el);
    const rel = ($el.attr("rel") || "").split(/\s+/).filter(Boolean);
    if (!rel.includes("noopener")) {
      rel.push("noopener");
      $el.attr("rel", rel.join(" "));
      stats.noopener += 1;
    }
    // Announce the new-window behaviour to screen readers.
    const name = accessibleName($, el);
    if (name && !/new (tab|window)/i.test(name) && !$el.attr("aria-label")) {
      $el.append('<span class="sb-sr-only"> (opens in a new tab)</span>');
    }
  });

  /* --- landmarks: make sure the main content region exists ---------- */
  if ($("main, [role='main']").length === 0) {
    const candidate = $("#content, #main, .site-content, .site-main, .elementor-location-single, [data-elementor-type='single'], [data-elementor-type='wp-page'], [data-elementor-type='page']").first();
    if (candidate.length) candidate.attr("role", "main");
  }
  $("header").first().each((_, el) => {
    if (!$(el).attr("role") && !$(el).closest("article, section, main").length) $(el).attr("role", "banner");
  });
  $("footer").last().each((_, el) => {
    if (!$(el).attr("role") && !$(el).closest("article, section, main").length) $(el).attr("role", "contentinfo");
  });
  $("nav").each((_, el) => {
    const $nav = $(el);
    if ($nav.attr("aria-label") || $nav.attr("aria-labelledby")) return;
    const cls = ($nav.attr("class") || "") + " " + ($nav.attr("id") || "");
    const label = /footer/i.test(cls) ? "Footer" : /mobile/i.test(cls) ? "Mobile" : /breadcrumb/i.test(cls) ? "Breadcrumb" : /social/i.test(cls) ? "Social links" : /secondary|utility|top/i.test(cls) ? "Secondary" : "Main";
    $nav.attr("aria-label", label);
  });

  /* --- misc ---------------------------------------------------------- */
  // Positive tabindex breaks focus order (2.4.3): normalise to 0.
  $("[tabindex]").each((_, el) => {
    const v = parseInt($(el).attr("tabindex") || "", 10);
    if (v > 0) $(el).attr("tabindex", "0");
  });
  // Empty headings confuse heading navigation.
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    if (!text($, el) && !$(el).find("img[alt]:not([alt=''])").length) $(el).attr("aria-hidden", "true");
  });
  // Duplicate ids are a 4.1.1 failure and break aria-controls / label for.
  // Later duplicates are renamed; the nearest <label for> follows the rename
  // (Elementor reuses form-field-* ids when a form appears twice on a page).
  const seen = new Set<string>();
  let dupSeq = 0;
  $("[id]").each((_, el) => {
    const id = $(el).attr("id") || "";
    if (!id) return;
    if (!seen.has(id)) {
      seen.add(id);
      return;
    }
    const next = `${id}-${++dupSeq}`;
    $(el).attr("id", next);
    // Walk up until a container holds exactly one label pointing at the old id.
    let scope = $(el).parent();
    for (let depth = 0; depth < 6 && scope.length; depth += 1) {
      const labels = scope.find(`label[for="${id.replace(/"/g, '\\"')}"]`);
      if (labels.length === 1) {
        labels.attr("for", next);
        break;
      }
      if (labels.length > 1) break;
      scope = scope.parent();
    }
  });

  return stats;
}
