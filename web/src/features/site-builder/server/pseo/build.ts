// Applies a pSEO plan (from the workbook) to a freshly cloned site's file map:
// keeps the crawled pages (adding the workbook's SEO fields, breadcrumbs and
// JSON-LD to them), generates every missing page in the site's own chrome,
// maps old URLs to new ones with permanent redirects, and decides what goes
// live now vs. on its scheduled date vs. on hold — then writes a report.
import * as cheerio from "cheerio";
import {
  normalizePath,
  type PagePublish,
  type PageRecord,
  type SiteRedirect,
} from "@/features/site-builder/server/content-store";
import { extractShell } from "@/features/site-builder/server/seo-into-clone";
import {
  readPagesFile,
  readSiteFile,
  writePagesFile,
  writeSiteFile,
  type FileMap,
} from "@/features/site-builder/server/site-content-files";
import type { PseoPlan, PseoType } from "./model";
import {
  breadcrumbHtml,
  breadcrumbLd,
  businessLd,
  exploreBlock,
  makeCtx,
  PSEO_CSS,
  renderPage,
  tokens,
  type SiteFacts,
} from "./render";

export type PseoOptions = {
  /** Keep the workbook's drip schedule (pages go live on their publish date). Default true. */
  respectSchedule?: boolean;
  /** Hold generated pages that are below the workbook's word floor. Default true. */
  qualityGate?: boolean;
  now?: Date;
};

export type PseoReport = {
  business: string;
  total: number;
  byType: Record<string, number>;
  live: number;
  scheduled: number;
  hold: number;
  kept: number;
  generated: number;
  redirects: SiteRedirect[];
  noindex: string[];
  held: Array<{ path: string; reasons: string[] }>;
  scheduledPages: Array<{ path: string; at: string }>;
  notInWorkbook: string[];
  warnings: string[];
  orderUrl: string;
  cateringUrl: string;
};

const ORDER_HINT = /innowi|order|toasttab|clover|square\.site|chownow|heartland|menufy|popmenu|spoton|olo\./i;
const DELIVERY = /doordash|ubereats|grubhub|postmates|seamless/i;
const SOCIAL = /(facebook|instagram|tiktok|twitter|x|yelp|youtube)\.com\//i;

function collectFacts(pages: Record<string, PageRecord>, origin: string, plan: PseoPlan): SiteFacts {
  const hrefs: string[] = [];
  const images: SiteFacts["images"] = [];
  const seenImg = new Set<string>();
  let businessType = "Restaurant";
  for (const rec of Object.values(pages)) {
    const $ = cheerio.load(rec.html);
    $("a[href]").each((_, a) => {
      hrefs.push(($(a).attr("href") || "").trim());
    });
    $("img[src]").each((_, img) => {
      const src = $(img).attr("src") || "";
      if (!src || src.startsWith("data:") || seenImg.has(src)) return;
      seenImg.add(src);
      images.push({ src, alt: ($(img).attr("alt") || "").trim() });
    });
  }
  const ext = hrefs.filter((h) => /^https?:/i.test(h));
  const pick = (re: RegExp, not?: RegExp) => ext.find((h) => re.test(h) && !(not && not.test(h))) || "";
  const orderUrl =
    pick(/innowi/i) || pick(ORDER_HINT, /google\.|facebook|instagram|gift|ezcater|catering/i) || pick(DELIVERY);
  const cateringUrl = pick(/ezcater|catering/i);
  const sameAs = [...new Set(ext.filter((h) => SOCIAL.test(h)).map((h) => h.replace(/\/+$/, "")))].slice(0, 6);
  const schemaHint = plan.business.cuisineLine + " " + plan.business.servesCuisine.join(" ");
  if (/cafe|coffee|chai|boba/i.test(schemaHint)) businessType = "CafeOrCoffeeShop";
  return { origin, orderUrl, cateringUrl, sameAs, images, oldContent: new Map(), businessType };
}

/** Main text of a crawled page, without its header/footer/nav — for migrating old dish copy. */
function mainText(html: string): { text: string[]; image?: string } {
  const $ = cheerio.load(html);
  $("header, footer, nav, script, style, noscript, form, .elementor-location-header, .elementor-location-footer").remove();
  const root = $("main").length ? $("main").first() : $("body");
  const text: string[] = [];
  root.find("p, li").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t.length >= 40 && !/\$\s?\d/.test(t) && !/cookie|copyright|©|all rights reserved/i.test(t) && !text.includes(t)) text.push(t);
  });
  const image = root.find("img[src]").first().attr("src");
  return { text: text.slice(0, 3), image: image && !image.startsWith("data:") ? image : undefined };
}

function slugTokens(path: string): string[] {
  return tokens(path.split("/").filter(Boolean).pop() || "");
}

/**
 * Crawled path whose slug best matches a planned page: most of the planned
 * slug's words appear in it (WordPress slugs often gain/lose a few words,
 * e.g. "…-paramount-industries" vs "…-paramount-industrial-business-parks").
 */
function fuzzyMatch(path: string, candidates: string[]): string | null {
  const want = slugTokens(path);
  if (!want.length) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const have = new Set(slugTokens(c));
    const stem = (t: string) => t.replace(/(ies|ial|s)$/, "");
    const haveStems = new Set([...have].map(stem));
    const hit = want.filter((t) => have.has(t) || haveStems.has(stem(t))).length;
    const cover = hit / want.length;
    const score = cover - Math.abs(have.size - want.length) * 0.01;
    if (cover >= 0.7 && score > bestScore) [best, bestScore] = [c, score];
  }
  return best;
}

function injectAfterHeader(html: string, header: string, block: string): string {
  if (!block) return html;
  if (header && html.includes(header)) return html.replace(header, `${header}\n${block}`);
  const $ = cheerio.load(html, null, false);
  const h = $("header").first();
  if (h.length) {
    h.after(block);
    return $.html();
  }
  return `${block}\n${html}`;
}

function injectBeforeFooter(html: string, footer: string, block: string): string {
  if (!block) return html;
  if (footer && html.includes(footer)) return html.replace(footer, `${block}\n${footer}`);
  return `${html}\n${block}`;
}

const TYPE_ORDER: PseoType[] = ["home", "hub-menu", "hub-near-me", "catering", "category", "dish", "geo", "combo", "blog"];

export function applyPseo(files: FileMap, plan: PseoPlan, options: PseoOptions = {}): { files: FileMap; report: PseoReport } {
  const respectSchedule = options.respectSchedule !== false;
  const qualityGate = options.qualityGate !== false;
  const today = (options.now || new Date()).toISOString().slice(0, 10);

  const data = readPagesFile(files);
  const site = readSiteFile(files) || { name: plan.business.name, origin: "https://example.com" };
  const b = plan.business;
  const origin = b.domain ? `https://${b.domain}` : site.origin;
  const crawledPaths = Object.keys(data.pages);
  const home = data.pages["/"];
  const shell = home ? extractShell(home.html) : { header: "", footer: "" };
  const facts = collectFacts(data.pages, origin, plan);
  const ctx = makeCtx(plan, facts);

  const redirects: SiteRedirect[] = [];
  const addRedirect = (from: string, to: string) => {
    const f = normalizePath(from);
    const t = normalizePath(to);
    if (f === t || redirects.some((r) => r.from === f)) return;
    redirects.push({ from: f, to: t });
  };
  const report: PseoReport = {
    business: b.name,
    total: plan.pages.length,
    byType: {},
    live: 0,
    scheduled: 0,
    hold: 0,
    kept: 0,
    generated: 0,
    redirects,
    noindex: [],
    held: [],
    scheduledPages: [],
    notInWorkbook: [],
    warnings: [...plan.warnings],
    orderUrl: facts.orderUrl,
    cateringUrl: facts.cateringUrl,
  };
  if (!facts.orderUrl) report.warnings.push("No online-ordering link found on the crawled site — \"Order online\" buttons were left out (add the Innowi order link in /admin).");

  // 1. Migrations: old dish URLs (Blossom: /menu-item/x → /menu/x). Take the
  //    old page's copy + photo into the new page, then 301 the old URL.
  const consumed = new Set<string>();
  for (const p of plan.pages) {
    if (!p.oldPath || p.oldPath === p.path) continue;
    const old = data.pages[p.oldPath];
    if (old) {
      facts.oldContent.set(p.path, mainText(old.html));
      consumed.add(p.oldPath);
    }
    addRedirect(p.oldPath, p.path);
  }

  // 2. "Existing" pages the crawl found under a slightly different URL.
  const unplanned = () => crawledPaths.filter((c) => !ctx.byPath.has(c) && !consumed.has(c) && c !== "/");
  const existingAt = new Map<string, string>();
  for (const p of plan.pages) {
    if (data.pages[p.path]) {
      existingAt.set(p.path, p.path);
      continue;
    }
    if (!/existing/i.test(p.sheetStatus)) continue;
    const hit = fuzzyMatch(p.path, unplanned());
    if (hit) {
      existingAt.set(p.path, hit);
      consumed.add(hit);
      addRedirect(hit, p.path);
    } else {
      report.warnings.push(`${p.url} is marked "Existing" in the workbook but wasn't found on the crawled site — generated a new page.`);
    }
  }

  const sorted = [...plan.pages].sort((x, y) => TYPE_ORDER.indexOf(x.type) - TYPE_ORDER.indexOf(y.type));
  for (const p of sorted) {
    report.byType[p.type] = (report.byType[p.type] || 0) + 1;
    const srcPath = existingAt.get(p.path);
    const existing = srcPath ? data.pages[srcPath] : undefined;
    const seo = {
      h1: p.h1 || undefined,
      canonical: `${origin}${p.path}`,
      keywords: [p.primaryKeyword, ...p.secondaryKeywords].filter(Boolean).join(", ") || undefined,
    };
    let record: PageRecord;
    let words = 0;
    let isGenerated = false;

    if (existing) {
      // Keep the real page; add breadcrumbs, links and structured data.
      let html = existing.html;
      if (p.type !== "home") html = injectAfterHeader(html, shell.header, `<div class="sb-pseo sb-pseo-crumbs-wrap">${breadcrumbHtml(ctx, p)}</div>`);
      html = injectBeforeFooter(html, shell.footer, exploreBlock(ctx, p));
      const ld: object[] = [];
      const bl = breadcrumbLd(ctx, p);
      if (bl) ld.push(bl);
      if (["home", "hub-near-me", "geo", "combo"].includes(p.type)) ld.push(businessLd(ctx));
      if (p.type === "blog")
        ld.push({
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: p.h1 || existing.title,
          url: seo.canonical,
          ...(p.primaryKeyword ? { keywords: p.primaryKeyword } : {}),
          publisher: { "@id": `${origin.replace(/\/$/, "")}/#business` },
        });
      // Crawled titles win over derived ones — unless they're generic ("Home - Omega Burger").
      const genericTitle = !existing.title || /^(home|welcome)\b/i.test(existing.title.trim()) || existing.title.trim().length < 15;
      const title = p.derivedSeo && !genericTitle ? existing.title : p.seoTitle || existing.title;
      const description = p.derivedSeo && existing.description ? existing.description : p.meta || existing.description || "";
      record = { ...existing, title, description, html, seo, jsonLd: ld, pageType: p.type };
      if (srcPath && srcPath !== p.path) delete data.pages[srcPath];
      report.kept += 1;
    } else {
      const r = renderPage(ctx, p, shell);
      words = r.words;
      record = {
        title: p.seoTitle || p.label,
        description: p.meta,
        html: r.main,
        seo,
        jsonLd: r.jsonLd,
        pageType: p.type,
        updatedAt: new Date().toISOString(),
      };
      isGenerated = true;
      report.generated += 1;
    }

    // Publishing decision.
    const reasons: string[] = [];
    const migrating = !!(p.oldPath && consumed.has(p.oldPath));
    if (/existing/i.test(p.sheetStatus) && !existing)
      reasons.push("Marked \"Existing\" in the workbook but not found on the crawled site — add its content, or check the URL.");
    if (/hold|gated/i.test(p.sheetStatus)) reasons.push("Gated in the workbook (Tier 3 / hold) — publish once it has unique local content.");
    if (p.type === "blog" && isGenerated) reasons.push(`Needs the article written (${p.wordFloor || "?"} words).`);
    else if (qualityGate && isGenerated && !migrating && p.wordFloor && words < p.wordFloor)
      reasons.push(`${words} unique words — below the ${p.wordFloor}-word floor for this page type. Add unique copy in the editor.`);
    let publish: PagePublish;
    if (existing && /existing/i.test(p.sheetStatus)) publish = { status: "live" };
    else if (reasons.length) publish = { status: "hold", reasons };
    else if (respectSchedule && !migrating && p.publishAt && p.publishAt > today) publish = { status: "scheduled", at: p.publishAt };
    else publish = { status: "live" };
    // An existing page that's already public stays public.
    if (existing && publish.status === "hold" && !/hold|gated/i.test(p.sheetStatus)) publish = { status: "live" };
    record.publish = publish;
    data.pages[p.path] = record;

    if (publish.status === "live") report.live += 1;
    else if (publish.status === "scheduled") {
      report.scheduled += 1;
      report.scheduledPages.push({ path: p.path, at: publish.at || "" });
    } else {
      report.hold += 1;
      report.held.push({ path: p.path, reasons });
    }
  }

  // 3. Retire migrated old pages (they now 301), noindex WordPress cruft.
  for (const old of consumed) if (!ctx.byPath.has(old)) delete data.pages[old];
  if (data.pages["/home"] && !ctx.byPath.has("/home")) delete data.pages["/home"];
  addRedirect("/home", "/");
  for (const [path, rec] of Object.entries(data.pages)) {
    if (/^\/author(\/|$)/.test(path) || /^\/\d{4}(\/\d{2})?(\/\d{2})?$/.test(path) || /^\/(tag|category)\//.test(path)) {
      rec.seo = { ...rec.seo, robots: "noindex, follow" };
      report.noindex.push(path);
    } else if (!ctx.byPath.has(path)) {
      report.notInWorkbook.push(path);
    }
  }

  writePagesFile(files, data);
  writeSiteFile(files, { ...site, canonicalOrigin: origin, redirects });

  const css = files["public/cloned.css"];
  const base = typeof css === "string" ? css : "";
  if (!base.includes(".sb-pseo-hero")) files["public/cloned.css"] = `${base}\n${PSEO_CSS}`;

  files["PSEO_REPORT.md"] = reportMarkdown(report, plan);
  return { files, report };
}

function reportMarkdown(r: PseoReport, plan: PseoPlan): string {
  const lines = [
    `# pSEO build — ${r.business}`,
    "",
    `Generated ${new Date().toISOString().slice(0, 10)} from the content-tree workbook.`,
    "",
    `| | Pages |`,
    `|---|---|`,
    `| In workbook | ${r.total} |`,
    `| Kept from the crawled site | ${r.kept} |`,
    `| Generated | ${r.generated} |`,
    `| Live now | ${r.live} |`,
    `| Scheduled (drip) | ${r.scheduled} |`,
    `| On hold | ${r.hold} |`,
    "",
    `By type: ${Object.entries(r.byType).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    "",
    `Order link: ${r.orderUrl || "not found"}  `,
    `Catering link: ${r.cateringUrl || "not found"}`,
    "",
    "## Warnings",
    ...(r.warnings.length ? r.warnings.map((w) => `- ${w}`) : ["- none"]),
    "",
    `## Redirects (${r.redirects.length})`,
    ...r.redirects.map((x) => `- ${x.from} → ${x.to}`),
    "",
    `## On hold (${r.held.length})`,
    "Publish these from /admin once they have enough unique content (or turn the quality gate off).",
    ...r.held.map((h) => `- ${h.path} — ${h.reasons.join(" ")}`),
    "",
    `## Scheduled (${r.scheduledPages.length})`,
    ...r.scheduledPages.map((s) => `- ${s.at} ${s.path}`),
    "",
    `## noindex (${r.noindex.length})`,
    ...r.noindex.map((p) => `- ${p}`),
    "",
    `## Crawled pages not in the workbook (${r.notInWorkbook.length}) — kept as-is`,
    ...r.notInWorkbook.map((p) => `- ${p}`),
    "",
    "## Business facts used",
    "```json",
    JSON.stringify(plan.business, null, 2),
    "```",
  ];
  return lines.join("\n");
}
