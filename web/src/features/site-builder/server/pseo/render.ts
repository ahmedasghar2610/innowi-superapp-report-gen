// Renders one pSEO page (from the workbook plan) into the cloned site's
// chrome: the crawled home page's header + footer around a <main> built from
// plain, editable HTML blocks (the /admin editor can change any of it).
//
// Rules from the workbook (read-me): never fabricate — every sentence here is
// built from workbook fields, the business facts (NAP / hours) or text that
// already exists on the crawled site; no prices anywhere; MenuItem without
// Offer; breadcrumbs follow the logical trail even though dish URLs are flat.
import { escapeHtml } from "@/features/site-builder/server/content-store";
import type { PseoPage, PseoPlan } from "./model";

export type SiteFacts = {
  /** Origin used for canonical URLs / JSON-LD ids ("https://omegabellflower.com"). */
  origin: string;
  /** Innowi / online-ordering link found on the crawled site. */
  orderUrl: string;
  /** Catering ordering link (ezCater etc.) found on the crawled site. */
  cateringUrl: string;
  /** Social profile URLs (sameAs). */
  sameAs: string[];
  /** Every <img> on the crawled site. */
  images: Array<{ src: string; alt: string }>;
  /** Text + image pulled from a dish's old (migrating) page. */
  oldContent: Map<string, { text: string[]; image?: string }>;
  /** Schema.org type for the business ("Restaurant", "CafeOrCoffeeShop"…). */
  businessType: string;
};

export type Rendered = { main: string; jsonLd: object[]; words: number };

export type RenderCtx = {
  plan: PseoPlan;
  facts: SiteFacts;
  byPath: Map<string, PseoPage>;
  byType: Map<string, PseoPage[]>;
  categoryByLabel: Map<string, PseoPage>;
};

const STOP = new Set(["the", "and", "a", "an", "of", "with", "in", "near", "me", "&", "or", "for", "to", "on", "at"]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&amp;/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function makeCtx(plan: PseoPlan, facts: SiteFacts): RenderCtx {
  const byPath = new Map<string, PseoPage>();
  const byType = new Map<string, PseoPage[]>();
  const categoryByLabel = new Map<string, PseoPage>();
  for (const p of plan.pages) {
    byPath.set(p.path, p);
    const list = byType.get(p.type) || [];
    list.push(p);
    byType.set(p.type, list);
    if (p.type === "category") categoryByLabel.set(p.label.toLowerCase(), p);
  }
  return { plan, facts, byPath, byType, categoryByLabel };
}

const e = (s: string) => escapeHtml(s || "");

function abs(ctx: RenderCtx, path: string): string {
  if (/^https?:/i.test(path)) return path;
  return `${ctx.facts.origin.replace(/\/$/, "")}${path}`;
}

/** Best crawled image for a label: every meaningful token must appear in its alt text or filename. */
export function findImage(ctx: RenderCtx, label: string): { src: string; alt: string } | null {
  const want = tokens(label);
  if (!want.length) return null;
  let best: { src: string; alt: string } | null = null;
  let bestScore = 0;
  for (const img of ctx.facts.images) {
    const hay = new Set([...tokens(img.alt), ...tokens(img.src.split("/").pop() || "")]);
    const hit = want.filter((t) => hay.has(t)).length;
    if (hit < want.length) continue;
    const score = hit * 10 - hay.size;
    if (score > bestScore) [best, bestScore] = [img, score];
  }
  return best;
}

// ---------------------------------------------------------------- blocks

/** Path a breadcrumb label points at (logical hierarchy, per sheet 17). */
function crumbPath(ctx: RenderCtx, label: string, page: PseoPage, index: number, total: number): string | null {
  if (index === total - 1) return page.path;
  const l = label.trim().toLowerCase();
  if (l === "home") return "/";
  if (l === "menu") return "/menu";
  if (l === "near me") return "/near-me";
  if (l === "catering") return "/catering";
  const cat = ctx.categoryByLabel.get(l);
  if (cat) return cat.path;
  const hit = ctx.plan.pages.find((p) => p.label.toLowerCase() === l || p.h1.toLowerCase() === l);
  return hit ? hit.path : null;
}

export function breadcrumbHtml(ctx: RenderCtx, page: PseoPage): string {
  const trail = page.breadcrumb;
  if (trail.length < 2) return "";
  const items = trail
    .map((label, i) => {
      const path = crumbPath(ctx, label, page, i, trail.length);
      if (i === trail.length - 1) return `<li aria-current="page">${e(label)}</li>`;
      return path ? `<li><a href="${e(path)}">${e(label)}</a></li>` : `<li>${e(label)}</li>`;
    })
    .join("");
  return `<nav class="sb-pseo-crumbs" aria-label="Breadcrumb"><ol>${items}</ol></nav>`;
}

export function breadcrumbLd(ctx: RenderCtx, page: PseoPage): object | null {
  const trail = page.breadcrumb;
  if (trail.length < 2) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((label, i) => {
      const path = crumbPath(ctx, label, page, i, trail.length);
      return {
        "@type": "ListItem",
        position: i + 1,
        name: label,
        ...(path ? { item: abs(ctx, path) } : {}),
      };
    }),
  };
}

function telHref(phone: string): string {
  const d = phone.replace(/[^\d+]/g, "");
  return d ? `tel:${d.startsWith("+") ? d : `+1${d}`}` : "";
}

function ctas(ctx: RenderCtx, label = "Order online"): string {
  const b = ctx.plan.business;
  const out: string[] = [];
  if (ctx.facts.orderUrl) out.push(`<a class="sb-pseo-btn" href="${e(ctx.facts.orderUrl)}" target="_blank" rel="noopener">${e(label)}</a>`);
  if (b.phone) out.push(`<a class="sb-pseo-btn sb-pseo-btn--ghost" href="${e(telHref(b.phone))}">Call ${e(b.phone)}</a>`);
  return out.length ? `<div class="sb-pseo-ctas">${out.join("")}</div>` : "";
}

function hero(ctx: RenderCtx, page: PseoPage, opts: { lede?: string; image?: { src: string; alt: string } | null; cta?: string } = {}): string {
  const lede = opts.lede ?? page.meta;
  const img = opts.image
    ? `<figure class="sb-pseo-hero-media"><img src="${e(opts.image.src)}" alt="${e(opts.image.alt || page.label)}" loading="eager"></figure>`
    : "";
  return `<section class="sb-pseo-hero${img ? " sb-pseo-hero--media" : ""}">
  <div class="sb-pseo-hero-text">
    <h1>${e(page.h1)}</h1>
    ${lede ? `<p class="sb-pseo-lede">${e(lede)}</p>` : ""}
    ${ctas(ctx, opts.cta)}
  </div>
  ${img}
</section>`;
}

/** `boiler` marks blocks repeated on every page (NAP, FAQ) — they don't count toward the unique-word floor. */
function section(title: string, body: string, cls = "", boiler = false): string {
  if (!body.trim()) return "";
  return `<section class="sb-pseo-section${cls ? ` ${cls}` : ""}"${boiler ? " data-pseo-boiler" : ""}>
  <h2>${e(title)}</h2>
  ${body}
</section>`;
}

/** Link list. `data-pseo-path` lets the site hide items whose page isn't published yet. */
function linkList(pages: PseoPage[], text: (p: PseoPage) => string = (p) => p.label): string {
  if (!pages.length) return "";
  return `<ul class="sb-pseo-links">${pages
    .map((p) => `<li data-pseo-path="${e(p.path)}"><a href="${e(p.path)}">${e(text(p))}</a></li>`)
    .join("")}</ul>`;
}

function cards(ctx: RenderCtx, pages: PseoPage[], sub?: (p: PseoPage) => string): string {
  if (!pages.length) return "";
  return `<div class="sb-pseo-grid">${pages
    .map((p) => {
      const img = findImage(ctx, p.label);
      const s = sub ? sub(p) : "";
      return `<a class="sb-pseo-card" href="${e(p.path)}" data-pseo-path="${e(p.path)}">${
        img ? `<img src="${e(img.src)}" alt="${e(img.alt || p.label)}" loading="lazy">` : ""
      }<span class="sb-pseo-card-title">${e(p.label)}</span>${s ? `<span class="sb-pseo-card-sub">${e(s)}</span>` : ""}</a>`;
    })
    .join("")}</div>`;
}

function visitBlock(ctx: RenderCtx, heading = "Visit us"): string {
  const b = ctx.plan.business;
  if (!b.address && !b.phone) return "";
  const rows: string[] = [];
  if (b.address) rows.push(`<p><strong>Address:</strong> ${e(b.address)}</p>`);
  if (b.hoursText) rows.push(`<p><strong>Hours:</strong> ${e(b.hoursText)}</p>`);
  if (b.phone) rows.push(`<p><strong>Phone:</strong> <a href="${e(telHref(b.phone))}">${e(b.phone)}</a></p>`);
  const q = encodeURIComponent(`${b.name}, ${b.address}`);
  const map = b.address
    ? `<div class="sb-pseo-map"><iframe title="Map to ${e(b.name)}" src="https://www.google.com/maps?q=${q}&amp;output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>`
    : "";
  return section(heading, `<div class="sb-pseo-visit"><div>${rows.join("")}${ctas(ctx)}</div>${map}</div>`, "sb-pseo-visit-wrap", true);
}

type Faq = { q: string; a: string };

function factualFaqs(ctx: RenderCtx, subject: string): Faq[] {
  const b = ctx.plan.business;
  const faqs: Faq[] = [];
  if (b.address) faqs.push({ q: `Where is ${b.brand}?`, a: `${b.brand} is at ${b.address}.` });
  const poss = /s$/i.test(b.brand) ? `${b.brand}'` : `${b.brand}'s`;
  if (b.hoursText) faqs.push({ q: `What are ${poss} hours?`, a: `We're open ${b.hoursText}.` });
  if (ctx.facts.orderUrl)
    faqs.push({ q: `Can I order ${subject} online?`, a: `Yes — order online for pickup or delivery through our ordering page.` });
  if (ctx.byType.get("catering")?.length)
    faqs.push({ q: `Does ${b.brand} cater?`, a: `Yes. See our catering page for group orders${b.phone ? ` or call ${b.phone}` : ""}.` });
  if (b.phone) faqs.push({ q: `How do I contact ${b.brand}?`, a: `Call us at ${b.phone}.` });
  return faqs.slice(0, 5);
}

function faqHtml(faqs: Faq[]): string {
  if (!faqs.length) return "";
  return section(
    "Frequently asked questions",
    `<div class="sb-pseo-faq">${faqs.map((f) => `<details><summary>${e(f.q)}</summary><p>${e(f.a)}</p></details>`).join("")}</div>`,
    "",
    true,
  );
}

function faqLd(faqs: Faq[]): object | null {
  if (!faqs.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function businessLd(ctx: RenderCtx): object {
  const b = ctx.plan.business;
  const f = ctx.facts;
  return {
    "@context": "https://schema.org",
    "@type": f.businessType,
    "@id": `${f.origin.replace(/\/$/, "")}/#business`,
    name: b.brand || b.name,
    url: abs(ctx, "/"),
    ...(b.phone ? { telephone: b.phone } : {}),
    ...(b.street
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: b.street,
            addressLocality: b.city,
            addressRegion: b.region,
            postalCode: b.postalCode,
            addressCountry: "US",
          },
        }
      : {}),
    ...(b.geo ? { geo: { "@type": "GeoCoordinates", latitude: b.geo.lat, longitude: b.geo.lng } } : {}),
    ...(b.openingHours.length ? { openingHours: b.openingHours } : {}),
    ...(b.priceRange ? { priceRange: b.priceRange } : {}),
    ...(b.servesCuisine.length ? { servesCuisine: b.servesCuisine } : {}),
    ...(f.sameAs.length ? { sameAs: f.sameAs } : {}),
    ...(ctx.byPath.has("/menu") ? { hasMenu: abs(ctx, "/menu") } : {}),
    ...(f.orderUrl ? { potentialAction: { "@type": "OrderAction", target: f.orderUrl } } : {}),
  };
}

function businessRef(ctx: RenderCtx) {
  return { "@id": `${ctx.facts.origin.replace(/\/$/, "")}/#business` };
}

// ---------------------------------------------------------------- relations

function dishesOf(ctx: RenderCtx, cat: PseoPage): PseoPage[] {
  const l = cat.label.toLowerCase();
  return (ctx.byType.get("dish") || []).filter((d) => (d.category || "").toLowerCase() === l);
}

function tierRank(p: PseoPage): number {
  return Number(p.tier.match(/\d/)?.[0] || 9);
}

function topDishes(ctx: RenderCtx, n: number, exclude = ""): PseoPage[] {
  return [...(ctx.byType.get("dish") || [])]
    .filter((d) => d.path !== exclude)
    .sort((a, b) => tierRank(a) - tierRank(b))
    .slice(0, n);
}

/** Pages whose label shares a meaningful token with `label` (e.g. "Burgers Near Me" ↔ "Char-Broiled Burgers"). */
function related(pages: PseoPage[], label: string, exclude: string, n: number): PseoPage[] {
  const want = new Set(tokens(label));
  return pages
    .filter((p) => p.path !== exclude)
    .map((p) => ({ p, s: tokens(`${p.label} ${p.cuisine || ""}`).filter((t) => want.has(t) || want.has(t.replace(/s$/, "")) || want.has(`${t}s`)).length }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || tierRank(a.p) - tierRank(b.p))
    .slice(0, n)
    .map((x) => x.p);
}

function nearMeFor(ctx: RenderCtx, label: string): PseoPage[] {
  const geos = (ctx.byType.get("geo") || []).filter((g) => /near/i.test(g.geoKind || "") || /near-me/.test(g.path));
  return related(geos, label, "", 2);
}

// ---------------------------------------------------------------- page types

function renderDish(ctx: RenderCtx, p: PseoPage): Rendered {
  const b = ctx.plan.business;
  const old = ctx.facts.oldContent.get(p.path);
  const img = (old?.image ? { src: old.image, alt: p.label } : null) || findImage(ctx, p.label);
  const cat = p.category ? ctx.categoryByLabel.get(p.category.toLowerCase()) : undefined;
  const siblings = cat ? dishesOf(ctx, cat).filter((d) => d.path !== p.path).slice(0, 3) : [];
  const about: string[] = [];
  for (const t of old?.text || []) about.push(`<p>${e(t)}</p>`);
  about.push(
    `<p>${e(p.label)} is on the ${cat ? `<a href="${e(cat.path)}">${e(cat.label)}</a>` : e(p.category || "")} menu at ${e(b.brand)}${
      b.street ? `, ${e(b.street)}` : ""
    }${b.city ? ` in ${e(b.city)}` : ""}. Order it for pickup or delivery, or add it to a catering order.</p>`.replace(" on the  menu", " on the menu"),
  );
  const more = [
    siblings.length ? section(`More ${cat?.label || "from the menu"}`, cards(ctx, siblings)) : "",
    section(
      "Keep exploring",
      linkList(
        [cat, ctx.byPath.get("/menu"), ...nearMeFor(ctx, `${p.label} ${p.category || ""}`), ctx.byPath.get("/catering")].filter(Boolean) as PseoPage[],
        (x) => (x.type === "hub-menu" ? "Full menu" : x.label),
      ),
    ),
  ];
  const main = [hero(ctx, p, { image: img, cta: `Order ${p.label}` }), section(`About the ${p.label}`, about.join("")), ...more, visitBlock(ctx)].join("\n");
  const item: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MenuItem",
    name: p.label,
    url: abs(ctx, p.path),
    description: old?.text[0] || p.meta,
  };
  if (img) item.image = /^https?:/.test(img.src) ? img.src : abs(ctx, img.src).replace(/\/$/, "");
  return { main, jsonLd: [item], words: 0 };
}

function renderCategory(ctx: RenderCtx, p: PseoPage): Rendered {
  const dishes = dishesOf(ctx, p);
  const cats = (ctx.byType.get("category") || []).filter((c) => c.path !== p.path);
  const relCats = related(cats, p.label, p.path, 3);
  const otherCats = relCats.length ? relCats : cats.slice(0, 3);
  const faqs = factualFaqs(ctx, p.label.toLowerCase());
  const main = [
    hero(ctx, p, { image: findImage(ctx, p.label) || (dishes[0] ? findImage(ctx, dishes[0].label) : null) }),
    section(`${p.label} on our menu`, cards(ctx, dishes) || `<p>Dishes for this section are listed on the <a href="/menu">menu</a>.</p>`),
    section("Related menu sections", linkList(otherCats)),
    section("Find us near you", linkList([...nearMeFor(ctx, p.label), ctx.byPath.get("/near-me")].filter(Boolean) as PseoPage[], (x) => x.label)),
    faqHtml(faqs),
    visitBlock(ctx),
  ].join("\n");
  const ld: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "MenuSection",
      name: p.label,
      url: abs(ctx, p.path),
      hasMenuItem: dishes.map((d) => ({ "@type": "MenuItem", name: d.label, url: abs(ctx, d.path) })),
    },
  ];
  const f = faqLd(faqs);
  if (f) ld.push(f);
  return { main, jsonLd: ld, words: 0 };
}

function renderMenuHub(ctx: RenderCtx, p: PseoPage): Rendered {
  const cats = ctx.byType.get("category") || [];
  const main = [
    hero(ctx, p),
    section("Menu sections", cards(ctx, cats, (c) => `${dishesOf(ctx, c).length} items`)),
    section("Popular picks", linkList(topDishes(ctx, 8))),
    visitBlock(ctx),
  ].join("\n");
  return {
    main,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Menu",
        name: `${ctx.plan.business.brand} menu`,
        url: abs(ctx, p.path),
        hasMenuSection: cats.map((c) => ({
          "@type": "MenuSection",
          name: c.label,
          url: abs(ctx, c.path),
          hasMenuItem: dishesOf(ctx, c).map((d) => ({ "@type": "MenuItem", name: d.label, url: abs(ctx, d.path) })),
        })),
      },
    ],
    words: 0,
  };
}

function geoGroups(ctx: RenderCtx): Map<string, PseoPage[]> {
  const groups = new Map<string, PseoPage[]>();
  for (const g of ctx.byType.get("geo") || []) {
    const k = g.geoKind || "Nearby";
    const list = groups.get(k) || [];
    list.push(g);
    groups.set(k, list);
  }
  return groups;
}

function renderNearMeHub(ctx: RenderCtx, p: PseoPage): Rendered {
  const parts = [hero(ctx, p)];
  for (const [kind, list] of geoGroups(ctx)) parts.push(section(kind.replace(/-/g, " "), linkList(list)));
  parts.push(section("Popular in the area", linkList(ctx.byType.get("combo") || [])));
  parts.push(visitBlock(ctx));
  return { main: parts.join("\n"), jsonLd: [businessLd(ctx)], words: 0 };
}

function renderGeo(ctx: RenderCtx, p: PseoPage): Rendered {
  const b = ctx.plan.business;
  const siblings = (ctx.byType.get("geo") || []).filter((g) => g.path !== p.path && g.geoKind === p.geoKind).slice(0, 6);
  const combos = (ctx.byType.get("combo") || []).filter((c) => (c.location || "").toLowerCase() === p.label.toLowerCase());
  const cats = related(ctx.byType.get("category") || [], p.label, "", 3);
  const faqs = factualFaqs(ctx, "food");
  const intro = `<p>${e(b.brand)} is at ${e(b.address || b.city)}${b.cuisineLine ? ` — ${e(b.cuisineLine.toLowerCase())}` : ""}. Order ahead for pickup or delivery, or stop in.</p>`;
  const main = [
    hero(ctx, p),
    section(`${p.label}: ${b.brand}`, intro),
    section("Popular picks", cards(ctx, topDishes(ctx, 6))),
    cats.length ? section("Browse the menu", linkList([...cats, ctx.byPath.get("/menu")].filter(Boolean) as PseoPage[], (x) => (x.type === "hub-menu" ? "Full menu" : x.label))) : "",
    combos.length ? section(`More in ${p.label}`, linkList(combos)) : "",
    siblings.length ? section("Nearby areas", linkList(siblings)) : "",
    faqHtml(faqs),
    visitBlock(ctx, "Directions & hours"),
  ].join("\n");
  const ld: object[] = [businessLd(ctx)];
  const f = faqLd(faqs);
  if (f) ld.push(f);
  return { main, jsonLd: ld, words: 0 };
}

function renderCombo(ctx: RenderCtx, p: PseoPage): Rendered {
  const b = ctx.plan.business;
  const loc = (ctx.byType.get("geo") || []).find((g) => g.label.toLowerCase() === (p.location || "").toLowerCase());
  const cuisineCats = related(ctx.byType.get("category") || [], p.cuisine || "", "", 3);
  const dishes = related(ctx.byType.get("dish") || [], p.cuisine || "", "", 6);
  const others = (ctx.byType.get("combo") || []).filter((c) => c.path !== p.path && (c.cuisine === p.cuisine || c.location === p.location)).slice(0, 6);
  const faqs = factualFaqs(ctx, (p.cuisine || "food").toLowerCase());
  const main = [
    hero(ctx, p),
    section(
      `${p.cuisine || "Food"} from ${b.brand}`,
      `<p>${e(b.brand)} is at ${e(b.address || b.city)}${loc ? `, close to <a href="${e(loc.path)}">${e(loc.label)}</a>` : ""}. Order ahead for pickup or delivery.</p>`,
    ),
    section("On the menu", cards(ctx, dishes.length ? dishes : topDishes(ctx, 6))),
    cuisineCats.length ? section("Menu sections", linkList(cuisineCats)) : "",
    others.length ? section("Nearby", linkList(others)) : "",
    faqHtml(faqs),
    visitBlock(ctx),
  ].join("\n");
  const ld: object[] = [businessLd(ctx)];
  const f = faqLd(faqs);
  if (f) ld.push(f);
  return { main, jsonLd: ld, words: 0 };
}

function renderCatering(ctx: RenderCtx, p: PseoPage): Rendered {
  const b = ctx.plan.business;
  const cats = ctx.byType.get("category") || [];
  const faqs = factualFaqs(ctx, "catering");
  const cta = ctx.facts.cateringUrl
    ? `<div class="sb-pseo-ctas"><a class="sb-pseo-btn" href="${e(ctx.facts.cateringUrl)}" target="_blank" rel="noopener">Order catering</a>${
        b.phone ? `<a class="sb-pseo-btn sb-pseo-btn--ghost" href="${e(telHref(b.phone))}">Call ${e(b.phone)}</a>` : ""
      }</div>`
    : ctas(ctx, "Order for a group");
  const main = [
    hero(ctx, p, { lede: p.meta }),
    section("Plan your order", `<p>Tell us your date, headcount and pickup or delivery — we'll help you put the order together.</p>${cta}`),
    section("Popular for groups", cards(ctx, cats.slice(0, 6))),
    faqHtml(faqs),
    visitBlock(ctx),
  ].join("\n");
  const ld: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      serviceType: "Catering",
      name: p.h1,
      url: abs(ctx, p.path),
      provider: businessRef(ctx),
      ...(b.city ? { areaServed: b.city } : {}),
    },
  ];
  const f = faqLd(faqs);
  if (f) ld.push(f);
  return { main, jsonLd: ld, words: 0 };
}

function renderBlog(ctx: RenderCtx, p: PseoPage): Rendered {
  const target = p.linksTo ? ctx.byPath.get(p.linksTo.replace(/\/+$/, "") || "/") : undefined;
  const main = [
    `<article class="sb-pseo-article">
  <h1>${e(p.h1)}</h1>
  <p class="sb-pseo-draft">Draft — write this ${e((p.blogType || "article").toLowerCase())} in the editor (target: ${p.wordFloor || "—"} words, keyword “${e(p.primaryKeyword)}”). It stays unpublished until then.</p>
  ${target ? `<p>Related: <a href="${e(target.path)}">${e(target.label)}</a></p>` : ""}
</article>`,
  ].join("\n");
  return {
    main,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: p.h1,
        url: abs(ctx, p.path),
        publisher: businessRef(ctx),
      },
    ],
    words: 0,
  };
}

/** Links block injected into an existing crawled page (home / crawled hubs). */
export function exploreBlock(ctx: RenderCtx, p: PseoPage): string {
  let links: PseoPage[] = [];
  let title = "Explore";
  if (p.type === "home") {
    links = [ctx.byPath.get("/menu"), ...(ctx.byType.get("category") || []).slice(0, 4), ctx.byPath.get("/near-me"), ctx.byPath.get("/catering")].filter(
      Boolean,
    ) as PseoPage[];
  } else if (p.type === "hub-menu") {
    title = "Menu sections";
    links = ctx.byType.get("category") || [];
  } else if (p.type === "hub-near-me") {
    title = "Areas we serve";
    links = ctx.byType.get("geo") || [];
  } else if (p.type === "catering") {
    title = "Popular for groups";
    links = (ctx.byType.get("category") || []).slice(0, 6);
  } else return "";
  if (!links.length) return "";
  return `<section class="sb-pseo sb-pseo-explore" data-pseo-block="explore"><div class="sb-pseo-section"><h2>${e(title)}</h2>${linkList(links, (x) =>
    x.type === "hub-menu" ? "Menu" : x.type === "hub-near-me" ? "Near me" : x.label,
  )}</div></section>`;
}

export function renderPage(ctx: RenderCtx, p: PseoPage, shell: { header: string; footer: string }): Rendered {
  let r: Rendered;
  switch (p.type) {
    case "dish":
      r = renderDish(ctx, p);
      break;
    case "category":
      r = renderCategory(ctx, p);
      break;
    case "hub-menu":
      r = renderMenuHub(ctx, p);
      break;
    case "hub-near-me":
      r = renderNearMeHub(ctx, p);
      break;
    case "geo":
      r = renderGeo(ctx, p);
      break;
    case "combo":
      r = renderCombo(ctx, p);
      break;
    case "catering":
      r = renderCatering(ctx, p);
      break;
    case "blog":
      r = renderBlog(ctx, p);
      break;
    default:
      r = { main: hero(ctx, p), jsonLd: [businessLd(ctx)], words: 0 };
  }
  const crumbs = breadcrumbHtml(ctx, p);
  const bl = breadcrumbLd(ctx, p);
  if (bl) r.jsonLd.unshift(bl);
  r.words = p.type === "blog" ? 0 : countWords(r.main);
  r.main = `${shell.header}
<main class="sb-pseo sb-pseo--${p.type}" data-pseo-id="${e(p.id)}">
${crumbs}
${r.main}
</main>
${shell.footer}`;
  return r;
}

/** Words on the page, excluding blocks repeated site-wide (visit/NAP, FAQ) and buttons. */
export function countWords(html: string): number {
  const text = html
    .replace(/<section[^>]*data-pseo-boiler[\s\S]*?<\/section>/gi, " ")
    .replace(/<div class="sb-pseo-ctas">[\s\S]*?<\/div>/gi, " ")
    .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  return (text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length;
}

export const PSEO_CSS = `
/* pSEO pages (generated from the workbook) — not compiled by LightningCSS */
#cloned-root .sb-pseo { --pseo-accent: var(--sb-theme-accent, #b4232a); --pseo-muted: var(--sb-theme-muted, #6b6b6b); max-width: var(--sb-theme-max-width, 72rem); margin: 0 auto; padding: 1.25rem 1.25rem 3.5rem; box-sizing: border-box; }
#cloned-root .sb-pseo *, #cloned-root .sb-pseo *::before, #cloned-root .sb-pseo *::after { box-sizing: border-box; }
#cloned-root .sb-pseo-crumbs ol { list-style: none; display: flex; flex-wrap: wrap; gap: .35rem; padding: 0; margin: 0 0 1.25rem; font-size: .85rem; color: var(--pseo-muted); }
#cloned-root .sb-pseo-crumbs li + li::before { content: "›"; margin-right: .35rem; opacity: .7; }
#cloned-root .sb-pseo-crumbs a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
#cloned-root .sb-pseo-hero { display: grid; gap: 1.5rem; align-items: center; padding: 1rem 0 2rem; }
#cloned-root .sb-pseo-hero--media { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); }
#cloned-root .sb-pseo-hero h1 { font-size: clamp(1.9rem, 4vw, 3rem); line-height: 1.1; margin: 0 0 .75rem; }
#cloned-root .sb-pseo-lede { font-size: 1.1rem; line-height: 1.6; margin: 0 0 1.25rem; max-width: 40rem; }
#cloned-root .sb-pseo-hero-media { margin: 0; }
#cloned-root .sb-pseo-hero-media img { width: 100%; height: auto; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--sb-theme-radius, 14px); display: block; }
#cloned-root .sb-pseo-ctas { display: flex; flex-wrap: wrap; gap: .75rem; margin: .5rem 0 0; }
#cloned-root .sb-pseo-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: .7rem 1.3rem; border-radius: 999px; background: var(--pseo-accent); color: #fff; font-weight: 600; text-decoration: none; border: 2px solid var(--pseo-accent); }
#cloned-root .sb-pseo-btn--ghost { background: transparent; color: var(--pseo-accent); }
#cloned-root .sb-pseo-btn:hover { filter: brightness(1.08); }
#cloned-root .sb-pseo-section { padding: 1.75rem 0; border-top: 1px solid rgba(127,127,127,.25); }
#cloned-root .sb-pseo-section h2 { font-size: clamp(1.35rem, 2.4vw, 1.8rem); margin: 0 0 1rem; }
#cloned-root .sb-pseo-section p { line-height: 1.7; margin: 0 0 .9rem; max-width: 46rem; }
#cloned-root .sb-pseo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 1rem; }
#cloned-root .sb-pseo-card { display: flex; flex-direction: column; gap: .35rem; padding: .75rem; border: 1px solid rgba(127,127,127,.25); border-radius: var(--sb-theme-radius, 14px); color: inherit; text-decoration: none; background: rgba(127,127,127,.04); }
#cloned-root .sb-pseo-card:hover { border-color: var(--pseo-accent); }
#cloned-root .sb-pseo-card img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: calc(var(--sb-theme-radius, 14px) - 4px); }
#cloned-root .sb-pseo-card-title { font-weight: 600; }
#cloned-root .sb-pseo-card-sub { font-size: .85rem; color: var(--pseo-muted); }
#cloned-root .sb-pseo-links { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: .5rem; }
#cloned-root .sb-pseo-links a { display: inline-block; padding: .45rem .9rem; border: 1px solid rgba(127,127,127,.35); border-radius: 999px; color: inherit; text-decoration: none; }
#cloned-root .sb-pseo-links a:hover { border-color: var(--pseo-accent); color: var(--pseo-accent); }
#cloned-root .sb-pseo-visit { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 1.5rem; align-items: start; }
#cloned-root .sb-pseo-map iframe { width: 100%; aspect-ratio: 4 / 3; border: 0; border-radius: var(--sb-theme-radius, 14px); }
#cloned-root .sb-pseo-faq details { border-bottom: 1px solid rgba(127,127,127,.25); padding: .85rem 0; }
#cloned-root .sb-pseo-faq summary { cursor: pointer; font-weight: 600; }
#cloned-root .sb-pseo-faq details p { margin: .6rem 0 0; }
#cloned-root .sb-pseo-article { max-width: 46rem; margin: 0 auto; }
#cloned-root .sb-pseo-draft { padding: .75rem 1rem; border: 1px dashed var(--pseo-accent); border-radius: 10px; }
#cloned-root .sb-pseo-explore { padding-top: 0; padding-bottom: 1.5rem; }
@media (max-width: 760px) {
  #cloned-root .sb-pseo-hero--media, #cloned-root .sb-pseo-visit { grid-template-columns: 1fr; }
  #cloned-root .sb-pseo-hero-media { order: -1; }
}
`;
