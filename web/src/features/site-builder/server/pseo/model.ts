// Turns a pSEO content-tree workbook (the 18-sheet format used for Omega
// Burgers, My Blossom and Desi Dhaba) into a flat list of page records plus
// the business facts every page needs. Columns are matched by header NAME,
// never position, so per-client variations ("URL (flat)" vs "URL (flat,
// new)", an extra "301 From (old)" column, extra field-map rows) all read.
//
// Sheet 11 (Publishing Schedule) is the master list — every page to build,
// with its ID, URL, type, tier, phase, publish date and status. Sheets 02–06
// add each page's SEO fields, joined by ID (02–05) or URL (06/07).
import { normalizePath } from "@/features/site-builder/server/content-store";
import { col, findSheet, norm, tableOf, type Workbook } from "./xlsx";

export type PseoType = "home" | "hub-menu" | "hub-near-me" | "catering" | "category" | "dish" | "geo" | "combo" | "blog";

export type PseoPage = {
  id: string;
  type: PseoType;
  /** Normalised path ("/menu/cheeseburger"). */
  path: string;
  /** As written in the workbook ("/menu/cheeseburger/"). */
  url: string;
  label: string;
  seoTitle: string;
  h1: string;
  meta: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  breadcrumb: string[];
  schema: string;
  tier: string;
  phase: string;
  /** Sheet-11 status: Queued | Existing | Hold (gated) | Migrate/Upgrade. */
  sheetStatus: string;
  /** YYYY-MM-DD when the sheet schedules it; empty when gated / already live. */
  publishAt: string;
  /** Dish migrating from an old URL (Blossom): "/menu-item/samosa-chaat". */
  oldPath?: string;
  category?: string;
  geoKind?: string;
  location?: string;
  cuisine?: string;
  /** Blog: pillar / cluster, the money page it must link to. */
  blogType?: string;
  linksTo?: string;
  /** Minimum unique words from sheet 13 (0 = none). */
  wordFloor: number;
  /** True when title/meta were derived here (no workbook row) — an existing crawled page's own title wins. */
  derivedSeo?: boolean;
};

export type Business = {
  name: string;
  /** Short brand used in the workbook's SEO titles ("Omega Burgers"). */
  brand: string;
  domain: string;
  address: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  phone: string;
  cuisineLine: string;
  servesCuisine: string[];
  priceRange: string;
  geo?: { lat: number; lng: number };
  /** schema.org openingHours strings, e.g. "Su-Th 07:00-21:00". */
  openingHours: string[];
  /** Human hours line when known ("Sun–Thu 7am–9pm, Fri–Sat 7am–10pm"). */
  hoursText: string;
};

export type PseoPlan = {
  business: Business;
  pages: PseoPage[];
  /** Field-map rows by page type (sheet 12): which fields each template needs. */
  fieldMaps: Record<string, Array<{ field: string; required: boolean; core: boolean; source: string }>>;
  warnings: string[];
};

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s(\-/&])([a-z])/g, (_, pre: string, ch: string) => pre + ch.toUpperCase());
}

function splitList(s: string): string[] {
  return s
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const DAY: Record<string, string> = { sun: "Su", mon: "Mo", tue: "Tu", wed: "We", thu: "Th", fri: "Fr", sat: "Sa" };

function hh(n: string): string {
  const [h, m] = n.split(":");
  return `${h.padStart(2, "0")}:${(m || "00").padStart(2, "0")}`;
}

/** "Sun-Thu 7-21, Fri-Sat 7-22" → ["Su-Th 07:00-21:00", "Fr-Sa 07:00-22:00"]. */
function parseHours(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/,\s*/)) {
    const m = part.match(/^\s*([A-Za-z]{3})(?:\s*-\s*([A-Za-z]{3}))?\s+(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\s*$/);
    if (!m) continue;
    const a = DAY[m[1].toLowerCase()];
    const b = m[2] ? DAY[m[2].toLowerCase()] : "";
    if (!a) continue;
    out.push(`${a}${b ? `-${b}` : ""} ${hh(m[3])}-${hh(m[4])}`);
  }
  return out;
}

function hoursHuman(text: string): string {
  const fmt = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "pm" : "am";
    const h12 = h % 12 || 12;
    return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${ap}`;
  };
  return text
    .split(/,\s*/)
    .map((part) => {
      const m = part.match(/^\s*([A-Za-z]{3}(?:\s*-\s*[A-Za-z]{3})?)\s+(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\s*$/);
      return m ? `${m[1].replace(/\s*-\s*/, "–")} ${fmt(m[2])}–${fmt(m[3])}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

function readBusiness(wb: Workbook, warnings: string[]): Business {
  const readme = findSheet(wb, "00")?.rows || [];
  const titleLine = (readme[0]?.[0] || "").split(/\s+[—–-]\s+/)[0].trim();
  const parts = (readme[1]?.[0] || "").split("|").map((p) => p.trim());
  const domain = parts.find((p) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(p)) || "";
  const address = parts.find((p) => /\d/.test(p) && p.includes(",") && !/\(\d{3}\)/.test(p)) || "";
  const phone = parts.find((p) => /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(p)) || "";
  const cuisineLine = parts.find((p) => p && p !== domain && p !== address && p !== phone && !/build/i.test(p)) || "";

  const addrParts = address.split(",").map((p) => p.trim());
  const street = addrParts[0] || "";
  const city = addrParts.length >= 3 ? addrParts[addrParts.length - 2] : addrParts[1] || "";
  const stateZip = (addrParts[addrParts.length - 1] || "").match(/([A-Z]{2})\s+(\d{5})/);

  const schemaRows = tableOf(findSheet(wb, "10"));
  const lb = schemaRows.find((r) => /local ?business|restaurant/i.test(col(r, "item")))?.[
    Object.keys(schemaRows[0] || {}).find((k) => norm(k) === "action") || "Action"
  ] || "";
  const geo = lb.match(/geo\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i);
  const hoursRaw = lb.match(/openingHours\s*\(([^)]*)\)/i)?.[1] || "";
  const openingHours = parseHours(hoursRaw);
  const price = lb.match(/priceRange\s*'([^']+)'/i)?.[1] || "";
  const cuisines = [...(lb.match(/servesCuisine\s*\[([^\]]*)\]/i)?.[1] || "").matchAll(/'([^']+)'/g)].map((m) => m[1]);

  if (!titleLine) warnings.push("README: business name not found on row 1.");
  if (!address) warnings.push("README: address not found on row 2.");
  if (!phone) warnings.push("README: phone not found on row 2.");
  if (!openingHours.length) warnings.push("Opening hours aren't in a machine-readable form in sheet 10 — left out of the structured data (add them in /admin or the workbook).");
  if (!geo) warnings.push("Geo coordinates not found in sheet 10.");

  return {
    name: titleCase(titleLine),
    brand: brandFromTitles(wb) || titleCase(titleLine),
    domain,
    address,
    street,
    city,
    region: stateZip?.[1] || "",
    postalCode: stateZip?.[2] || "",
    phone,
    cuisineLine,
    servesCuisine: cuisines,
    priceRange: price,
    geo: geo ? { lat: Number(geo[1]), lng: Number(geo[2]) } : undefined,
    openingHours,
    hoursText: openingHours.length ? hoursHuman(hoursRaw) : "",
  };
}

/** Most common "… | Brand" suffix across the page sheets' SEO titles. */
function brandFromTitles(wb: Workbook): string {
  const counts = new Map<string, number>();
  for (const prefix of ["02", "03", "04", "05"]) {
    for (const r of tableOf(findSheet(wb, prefix))) {
      const t = col(r, "seo title");
      const i = t.lastIndexOf("|");
      if (i < 0) continue;
      const b = t.slice(i + 1).trim();
      if (b) counts.set(b, (counts.get(b) || 0) + 1);
    }
  }
  let best = "";
  let n = 0;
  for (const [b, c] of counts) if (c > n || (c === n && b.length < best.length)) [best, n] = [b, c];
  return best;
}

/** Sheet metas are cut at 155 chars mid-word — end them on a whole word. */
export function cleanMeta(meta: string): string {
  const m = meta.trim();
  if (m.length < 150 || /[.!?)]$/.test(m)) return m;
  const cut = m.slice(0, m.lastIndexOf(" ")).replace(/[\s,;:&—–-]+$/, "").replace(/\s+(?:&|and|or|for|to|the|a|an|on|in|at|—|-)$/i, "");
  return /[.!?]$/.test(cut) ? cut : `${cut}.`;
}

function typeOf(pageType: string, path: string): PseoType | null {
  const t = pageType.toLowerCase();
  if (t.startsWith("hub")) return path === "/" ? "home" : path.startsWith("/menu") ? "hub-menu" : "hub-near-me";
  if (t.startsWith("pillar")) return "catering";
  if (t.startsWith("category")) return "category";
  if (t.startsWith("menu item")) return "dish";
  if (t.startsWith("geo")) return "geo";
  if (t.startsWith("combo")) return "combo";
  if (t.startsWith("blog")) return "blog";
  return null;
}

function floorFor(type: PseoType, blueprints: Array<Record<string, string>>, blogType = ""): number {
  const key =
    type === "dish"
      ? "menu item"
      : type === "category"
        ? "category"
        : type === "geo"
          ? "geo"
          : type === "combo"
            ? "combo"
            : type === "catering"
              ? "catering"
              : type === "blog"
                ? blogType.toLowerCase().includes("pillar")
                  ? "blog pillar"
                  : "blog cluster"
                : "hub";
  const row = blueprints.find((r) => norm(col(r, "page type")).startsWith(key));
  return Number(col(row || {}, "min unique words")) || 0;
}

export function buildPlan(wb: Workbook): PseoPlan {
  const warnings: string[] = [];
  const business = readBusiness(wb, warnings);

  const schedule = tableOf(findSheet(wb, "11"));
  if (!schedule.length) throw new Error("Sheet 11 (Publishing Schedule) is missing or empty — it's the list of pages to build.");

  const byId = new Map<string, Record<string, string>>();
  for (const prefix of ["02", "03", "04", "05"]) {
    for (const r of tableOf(findSheet(wb, prefix))) {
      const id = col(r, "id");
      if (id) byId.set(id, r);
    }
  }
  const clusters = tableOf(findSheet(wb, "06"));
  const blogCal = tableOf(findSheet(wb, "07"));
  const blueprints = tableOf(findSheet(wb, "13"));

  const fieldMaps: PseoPlan["fieldMaps"] = {};
  for (const r of tableOf(findSheet(wb, "12"))) {
    const t = norm(col(r, "page type"));
    (fieldMaps[t] ||= []).push({
      field: col(r, "field"),
      required: /^y/i.test(col(r, "required")),
      core: col(r, "uniqueness core").includes("★"),
      source: col(r, "data source"),
    });
  }

  const pages: PseoPage[] = [];
  const seen = new Set<string>();
  for (const s of schedule) {
    const id = col(s, "page id");
    const url = col(s, "url");
    const path = normalizePath(url);
    const type = typeOf(col(s, "page type"), path);
    if (!id || !url || !type) {
      warnings.push(`Sheet 11: skipped a row without a usable ID / URL / page type (${id || url || "?"}).`);
      continue;
    }
    if (seen.has(path)) {
      warnings.push(`Sheet 11: ${url} is listed twice — kept the first.`);
      continue;
    }
    seen.add(path);

    const src = byId.get(id) || {};
    const publishRaw = col(s, "publish at");
    const page: PseoPage = {
      id,
      type,
      path,
      url,
      label: "",
      seoTitle: col(src, "seo title"),
      h1: col(src, "h1"),
      meta: cleanMeta(col(src, "meta description")),
      primaryKeyword: col(src, "primary keyword", "target keyword"),
      secondaryKeywords: splitList(col(src, "secondary keywords")),
      breadcrumb: col(src, "breadcrumb trail")
        .split(">")
        .map((x) => x.trim())
        .filter(Boolean),
      schema: col(src, "schema"),
      tier: col(s, "tier"),
      phase: col(s, "phase"),
      sheetStatus: col(s, "status"),
      publishAt: /^\d{4}-\d{2}-\d{2}/.test(publishRaw) ? publishRaw.slice(0, 10) : "",
      wordFloor: 0,
    };

    if (type === "category") page.label = col(src, "category");
    if (type === "dish") {
      page.label = col(src, "dish");
      page.category = col(src, "logical category");
      const old = col(src, "301 from");
      if (old) page.oldPath = normalizePath(old);
    }
    if (type === "geo") {
      page.label = col(src, "location");
      page.geoKind = col(src, "page type") || col(s, "page type");
    }
    if (type === "combo") {
      page.cuisine = col(src, "cuisine");
      page.location = col(src, "location");
      page.label = `${page.cuisine} in ${page.location}`;
    }
    if (type === "blog") {
      const c = clusters.find((r) => normalizePath(col(r, "url")) === path);
      const title = col(c || {}, "cluster");
      const cal = blogCal.find((r) => norm(col(r, "working title")) === norm(title));
      page.label = title || col(cal || {}, "working title");
      page.primaryKeyword = col(c || {}, "target keyword") || col(cal || {}, "target keyword");
      page.blogType = col(c || {}, "type") || col(cal || {}, "type");
      page.linksTo = col(c || {}, "links to") || col(cal || {}, "internal link target");
      page.h1 = page.label;
      page.seoTitle = page.label;
      const floor = Number(col(cal || {}, "word floor"));
      if (floor) page.wordFloor = floor;
    }
    if (type === "home") page.label = "Home";
    if (type === "hub-menu") page.label = "Menu";
    if (type === "hub-near-me") page.label = "Near Me";
    if (type === "catering") page.label = "Catering";

    if (!page.wordFloor) page.wordFloor = floorFor(type, blueprints, page.blogType);
    if (!page.h1) page.h1 = page.label;
    if (!page.breadcrumb.length) page.breadcrumb = defaultTrail(page);
    pages.push(page);
  }

  // Hub / catering / home pages carry no SEO row of their own — derive it.
  const city = business.city;
  const brand = business.brand;
  const brandCity = city && !brand.toLowerCase().includes(city.toLowerCase()) ? `${brand} ${city}` : brand;
  const inCity = city ? ` in ${city}` : "";
  for (const p of pages) {
    if (p.seoTitle) continue;
    p.derivedSeo = true;
    if (p.type === "home") {
      const kinds = business.servesCuisine.slice(0, 2).join(" & ");
      p.seoTitle = `${brand}${inCity}${kinds ? ` | ${kinds}` : ""}`;
      p.h1 = `${brand}${inCity}`;
      p.meta = cleanMeta(
        `${brand}${business.address ? ` at ${business.address}` : inCity}.${business.cuisineLine ? ` ${business.cuisineLine}.` : ""} Order online for pickup or delivery.`,
      );
    } else if (p.type === "hub-menu") {
      p.seoTitle = `Menu | ${brandCity}`;
      p.h1 = "Our Menu";
      p.meta = `Browse the ${brand} menu${inCity} by category, then order direct for pickup or delivery.`;
    } else if (p.type === "hub-near-me") {
      p.seoTitle = `Near Me | ${brandCity}`;
      p.h1 = `${brand} Near You${inCity}`;
      p.meta = cleanMeta(`Neighborhoods, cities and landmarks near ${brand}${business.address ? ` at ${business.address}` : ""}.`);
    } else if (p.type === "catering") {
      p.seoTitle = `Catering${inCity} | ${brand}`;
      p.h1 = `Catering${inCity}`;
      p.meta = `${brand} catering${inCity} for offices, teams and family events. Order ahead for pickup or delivery.`;
    } else if (p.type === "blog") {
      p.seoTitle = p.label;
    }
  }

  return { business, pages, fieldMaps, warnings };
}

function defaultTrail(p: PseoPage): string[] {
  switch (p.type) {
    case "home":
      return ["Home"];
    case "hub-menu":
      return ["Home", "Menu"];
    case "hub-near-me":
      return ["Home", "Near Me"];
    case "catering":
      return ["Home", "Catering"];
    case "blog":
      return ["Home", "Blog", p.label];
    default:
      return ["Home", p.label];
  }
}
