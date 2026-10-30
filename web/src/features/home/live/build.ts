/**
 * Pure builders: live module data → the Command Center's section shapes
 * (data/command-center.mock.ts types). No React here, so the rules can be
 * read — and tested — on their own.
 */
import type { Overview, Flag, OverviewRow } from "@/features/gbp/types";
import type { Portfolio, PortfolioRow } from "@/features/ads/types";
import type { Integration } from "@/features/settings/types";
import type { DataQualityResponse } from "@/features/merchants/types/data-quality.types";
import type {
  CollapsedSection,
  IntegrationHealth,
  IssueItem,
  Kpi,
  ModuleHealth,
  Recommendation,
  Severity,
  SummarySegment,
  Trend,
} from "../data/command-center.mock";
import type { LiveSources } from "./sources";

/* ------------------------------------------------------------- format -- */

export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
export const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function delta(cur: number | null | undefined, prev: number | null | undefined): { delta: string; trend: Trend } {
  if (cur == null || prev == null) return { delta: "—", trend: "flat" };
  if (prev === 0) return cur === 0 ? { delta: "0%", trend: "flat" } : { delta: "new", trend: "up" };
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return { delta: "0%", trend: "flat" };
  return { delta: `${Math.abs(pct) >= 10 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%`, trend: pct > 0 ? "up" : "down" };
}

/* ------------------------------------------------------------ helpers -- */

const activeAds = (p?: Portfolio) => (p?.rows ?? []).filter((r) => r.state === "active");

interface AdsTotals {
  spend: number;
  clicks: number;
  impressions: number;
  orders: number;
  calls: number;
  revenue: number | null;
  roas: number | null;
  accounts: number;
}
export function adsTotals(p?: Portfolio): AdsTotals | null {
  if (!p) return null;
  const rows = activeAds(p);
  const t: AdsTotals = { spend: 0, clicks: 0, impressions: 0, orders: 0, calls: 0, revenue: null, roas: null, accounts: rows.length };
  let revSpend = 0;
  for (const r of rows) {
    t.spend += r.metrics.spend;
    t.clicks += r.metrics.clicks;
    t.impressions += r.metrics.impressions;
    t.orders += r.metrics.orders;
    t.calls += r.metrics.calls;
    if (r.revenue != null) {
      t.revenue = (t.revenue ?? 0) + r.revenue;
      revSpend += r.metrics.spend;
    }
  }
  if (t.revenue != null && revSpend > 0) t.roas = t.revenue / revSpend;
  return t;
}

const gbpIsDemo = (s: LiveSources) => !!s.gbp.status && s.gbp.status.locations.google === 0 && s.gbp.status.locations.demo > 0;
const adsIsDemo = (s: LiveSources) => !!s.ads.status && s.ads.status.accounts.google === 0 && s.ads.status.accounts.demo > 0;
export const sampleFlags = (s: LiveSources) => ({ gbp: gbpIsDemo(s), ads: adsIsDemo(s) });

const gbpHref = (id: string) => `/web/gbp/${id}`;
const adsHref = (id: string) => `/ads/${id}`;
const where = (title: string, city: string | null) => ({ merchant: title, location: city ?? "" });

/* -------------------------------------------------- 1 · integrations -- */

export function integrationHealth(s: LiveSources): IntegrationHealth | null {
  const list: Integration[] | undefined = s.integrations;
  if (!list) return null;
  const h: IntegrationHealth = { healthy: 0, delayed: 0, error: 0, notConfigured: 0 };
  const gbpLate = s.gbp.overview && s.gbp.overview.summary.syncIssues > 0;
  const adsLate = s.ads.now && s.ads.now.counts.syncIssue > 0;
  for (const i of list) {
    if (i.status === "planned" || i.status === "logged_only") continue;
    if (i.status === "attention") h.error += 1;
    else if (i.status === "not_connected") h.notConfigured += 1;
    else if ((i.key === "gbp" && gbpLate) || (i.key === "google_ads" && adsLate)) h.delayed += 1;
    else h.healthy += 1;
  }
  return h;
}

/* ----------------------------------------------------------- 3 · KPIs -- */

export function liveKpis(s: LiveSources): Kpi[] {
  const out: Kpi[] = [];
  const ov = s.gbp.overview;
  const demo = sampleFlags(s);
  const days = s.days;
  if (ov) {
    const add = (key: "total" | "views" | "calls" | "website" | "directions", label: string, hint: string) => {
      const t = ov.totals[key];
      out.push({
        key: `gbp-${key}`,
        label,
        value: fmtInt(t.current),
        ...delta(t.current, t.previous),
        compare: `vs ${fmtInt(t.previous)}`,
        spark: [],
        current: t.current,
        previous: t.previous,
        href: "/web/gbp",
        hint,
        isDemo: demo.gbp,
      });
    };
    add("total", "GBP Actions", `Calls, website clicks, directions, menu and order clicks from Google Business Profile, last ${days} days`);
    add("views", "Profile Views", `Times the listings were seen on Google Search and Maps, last ${days} days`);
    add("calls", "Calls from Google", `Calls started from the Google listings, last ${days} days`);
  }
  const now = adsTotals(s.ads.now);
  const prev = adsTotals(s.ads.prev);
  if (now) {
    const base = { spark: [] as number[], href: "/ads", isDemo: demo.ads };
    out.push({
      key: "ads-spend",
      label: "Ad Spend",
      value: fmtMoney(now.spend),
      ...delta(now.spend, prev?.spend),
      compare: `vs ${fmtMoney(prev?.spend)}`,
      upIsGood: undefined,
      current: now.spend,
      previous: prev?.spend ?? null,
      hint: `Google Ads cost across ${plural(now.accounts, "active account")}, last ${days} days`,
      ...base,
    });
    out.push({
      key: "ads-clicks",
      label: "Ad Clicks",
      value: fmtInt(now.clicks),
      ...delta(now.clicks, prev?.clicks),
      compare: `vs ${fmtInt(prev?.clicks)}`,
      current: now.clicks,
      previous: prev?.clicks ?? null,
      hint: `Clicks on Google Ads, last ${days} days`,
      ...base,
    });
    if (now.roas != null) {
      out.push({
        key: "ads-roas",
        label: "Ads ROAS",
        value: `${now.roas.toFixed(2)}×`,
        ...delta(now.roas, prev?.roas),
        compare: `vs ${prev?.roas != null ? `${prev.roas.toFixed(2)}×` : "—"}`,
        current: now.roas,
        previous: prev?.roas ?? null,
        hint: "Revenue from ad-driven orders ÷ spend, for accounts with an average ticket entered",
        ...base,
      });
    } else {
      out.push({
        key: "ads-orders",
        label: "Ad-driven Orders",
        value: fmtInt(now.orders),
        ...delta(now.orders, prev?.orders),
        compare: `vs ${fmtInt(prev?.orders)}`,
        current: now.orders,
        previous: prev?.orders ?? null,
        hint: "Order clicks from Google Ads location assets",
        ...base,
      });
    }
  }
  return out;
}

/* -------------------------------------------- 4 / 6 · issues & opps -- */

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "data", "low", "opportunity"];
export const bySeverity = (a: IssueItem, b: IssueItem) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity);

/** Per-listing GBP flags that become their own card. */
const GBP_SINGLE: Record<string, { severity: Severity; module: IssueItem["module"]; title: (t: string) => string; impact: (f: Flag) => string; status?: "Monitor" }> = {
  sync_failed: { severity: "critical", module: "Data", title: (t) => `Google Business data not syncing for ${t}`, impact: (f) => f.detail || "No new numbers until the sync works again" },
  verification_required: { severity: "high", module: "GBP", title: (t) => `Google asks to verify ${t}`, impact: () => "The listing can be hidden from Search and Maps until verified" },
  temporarily_closed: { severity: "high", module: "GBP", title: (t) => `${t} shows as temporarily closed`, impact: () => "Customers see the listing as closed on Google" },
  unanswered_reviews: { severity: "medium", module: "Reviews", title: (t) => `Reviews without a reply at ${t}`, impact: (f) => f.detail || "Unanswered reviews" },
  zero_calls: { severity: "medium", module: "GBP", title: (t) => `No calls from Google for ${t}`, impact: () => "0 calls this period" },
  data_delayed: { severity: "data", module: "Data", title: (t) => `GBP data delayed for ${t}`, impact: (f) => f.detail || "Numbers may be understated", status: "Monitor" },
  verification_pending: { severity: "low", module: "GBP", title: (t) => `Verification pending for ${t}`, impact: () => "Waiting for Google", status: "Monitor" },
};
/** Flags that are common and low-stakes — one portfolio card each. */
const GBP_GROUPED: Record<string, { severity: Severity; module: IssueItem["module"]; title: (n: number) => string; impact: string }> = {
  zero_website: { severity: "low", module: "GBP", title: (n) => `${plural(n, "listing")} with zero website clicks`, impact: "Check the website link on the profile" },
  zero_directions: { severity: "low", module: "GBP", title: (n) => `${plural(n, "listing")} with zero direction requests`, impact: "Check the address and map pin" },
  no_new_reviews: { severity: "low", module: "Reviews", title: (n) => `${plural(n, "listing")} with no new reviews`, impact: "Ask happy guests for a review" },
  no_posts: { severity: "opportunity", module: "GBP", title: (n) => `${plural(n, "listing")} have never posted`, impact: "Posts keep the profile fresh and add actions" },
  stale_posts: { severity: "opportunity", module: "GBP", title: (n) => `${plural(n, "listing")} without a recent post`, impact: "A weekly post keeps the profile active" },
};

function gbpIssues(ov: Overview, demo: boolean): IssueItem[] {
  const out: IssueItem[] = [];
  const grouped: Record<string, number> = {};
  for (const a of ov.attention) {
    const loc = a.location;
    for (const f of a.flags) {
      const single = GBP_SINGLE[f.code];
      if (single) {
        out.push({
          id: `gbp-${loc.id}-${f.code}`,
          code: `gbp.${f.code}`,
          severity: single.severity,
          module: single.module,
          status: single.status ?? "Open",
          title: single.title(loc.title),
          ...where(loc.title, loc.city),
          impact: single.impact(f),
          cta: "Open listing",
          href: gbpHref(loc.id),
          isDemo: demo,
        });
      } else if (f.code === "low_profile") {
        out.push({
          id: `gbp-${loc.id}-low_profile`,
          code: "gbp.low_profile",
          severity: "opportunity",
          module: "GBP",
          status: "Open",
          title: `Complete the Google profile for ${loc.title}`,
          ...where(loc.title, loc.city),
          impact: `${f.detail} — complete profiles get more views and actions`,
          cta: "Open listing",
          href: gbpHref(loc.id),
          isDemo: demo,
        });
      } else if (GBP_GROUPED[f.code]) {
        grouped[f.code] = (grouped[f.code] ?? 0) + 1;
      }
    }
  }
  for (const [code, n] of Object.entries(grouped)) {
    const g = GBP_GROUPED[code];
    out.push({
      id: `gbp-group-${code}`,
      code: `gbp.${code}`,
      severity: g.severity,
      module: g.module,
      status: "Open",
      title: g.title(n),
      merchant: "Portfolio",
      location: "Google Business Profile",
      impact: g.impact,
      cta: "Open GBP",
      href: "/web/gbp",
      isDemo: demo,
    });
  }
  if (ov.summary.unlinked > 0) {
    out.push({
      id: "gbp-unlinked",
      code: "gbp.unlinked",
      severity: "data",
      module: "Data",
      status: "Open",
      title: `${plural(ov.summary.unlinked, "GBP listing")} not linked to a merchant`,
      merchant: "Portfolio",
      location: "",
      impact: "Their numbers don't reach the merchant pages",
      cta: "Open GBP",
      href: "/web/gbp",
      isDemo: demo,
    });
  }
  return out;
}

const merchantName = (r: PortfolioRow) => r.merchant?.name ?? r.name;

function adsIssues(p: Portfolio, demo: boolean): IssueItem[] {
  const out: IssueItem[] = [];
  for (const r of activeAds(p)) {
    const base = { ...where(merchantName(r), r.city), cta: "Open account", href: adsHref(r.id), isDemo: demo, status: "Open" as const };
    for (const a of r.alerts) {
      if (a.type === "sync_issue")
        out.push({ id: `ads-${r.id}-sync`, code: "ads.sync_issue", severity: "critical", module: "Data", title: `Google Ads not syncing for ${merchantName(r)}`, impact: a.detail || "Numbers stop updating", ...base });
      else if (a.type === "verification_required")
        out.push({ id: `ads-${r.id}-verify`, code: "ads.verification_required", severity: "high", module: "Ads", title: `Advertiser verification required for ${merchantName(r)}`, impact: a.detail || "Ads can stop serving until verified", ...base });
      else if (a.type === "budget_mismatch")
        out.push({ id: `ads-${r.id}-budget`, code: "ads.budget_mismatch", severity: "medium", module: "Ads", title: `Budget mismatch for ${merchantName(r)}`, impact: a.detail || "Spend is off the approved budget", ...base });
    }
    if (r.roasStatus.key === "unprofitable" && r.metrics.spend > 0)
      out.push({
        id: `ads-${r.id}-roas`,
        code: "ads.unprofitable",
        severity: "high",
        module: "Ads",
        title: `Ads not paying back for ${merchantName(r)}`,
        impact: `ROAS ${r.roas != null ? r.roas.toFixed(2) : "—"} on ${fmtMoney(r.metrics.spend)} spend`,
        ...base,
      });
    else if (r.roasStatus.key === "excellent" && r.restaurantStatus === "active")
      out.push({
        id: `ads-${r.id}-strong`,
        code: "ads.strong_roas",
        severity: "opportunity",
        module: "Ads",
        title: `Strong return on ads for ${merchantName(r)}`,
        impact: `ROAS ${r.roas != null ? r.roas.toFixed(2) : "—"} — room to raise the budget`,
        ...base,
      });
  }
  if (p.counts.unlinked > 0)
    out.push({
      id: "ads-unlinked",
      code: "ads.unlinked",
      severity: "data",
      module: "Data",
      status: "Open",
      title: `${plural(p.counts.unlinked, "Ads account")} not linked to a merchant`,
      merchant: "Portfolio",
      location: "",
      impact: "Their spend doesn't reach the merchant pages",
      cta: "Link accounts",
      href: "/ads/unmapped",
      isDemo: demo,
    });
  return out;
}

function otherIssues(s: LiveSources): IssueItem[] {
  const out: IssueItem[] = [];
  const t = s.tickets;
  if (t.slaBreached)
    out.push({ id: "ops-sla", code: "ops.sla", severity: "high", module: "Ops", status: "Open", title: `${plural(t.slaBreached, "ticket")} past their SLA`, merchant: "Ops CRM", location: "", impact: "Merchants are waiting longer than promised", cta: "Open tickets", href: "/ops/tickets" });
  if (t.overdue)
    out.push({ id: "ops-overdue", code: "ops.overdue", severity: "medium", module: "Ops", status: "Open", title: `${plural(t.overdue, "ticket")} overdue`, merchant: "Ops CRM", location: "", impact: "Past their due date", cta: "Open tickets", href: "/ops/tickets" });
  const dq: DataQualityResponse | undefined = s.dataQuality;
  if (dq && dq.bands.critical > 0)
    out.push({ id: "profiles-critical", code: "profiles.critical", severity: "medium", module: "Profiles", status: "Open", title: `${plural(dq.bands.critical, "merchant profile")} critically incomplete`, merchant: "Portfolio", location: "", impact: `Below ${dq.thresholds.criticalBelowPct}% complete — reports and websites miss details`, cta: "Open data quality", href: "/data-quality" });
  if (dq && dq.connections.blocking > 0)
    out.push({ id: "profiles-blocking", code: "profiles.connections", severity: "data", module: "Data", status: "Open", title: `${plural(dq.connections.blocking, "blocking connection")} pending`, merchant: `${plural(dq.connections.merchantsWithBlockers, "merchant")}`, location: "", impact: "Access we still need from merchants", cta: "Open data quality", href: "/data-quality" });
  return out;
}

export function liveIssues(s: LiveSources): { issues: IssueItem[]; opportunities: IssueItem[] } {
  const demo = sampleFlags(s);
  const all = [
    ...(s.gbp.overview ? gbpIssues(s.gbp.overview, demo.gbp) : []),
    ...(s.ads.now ? adsIssues(s.ads.now, demo.ads) : []),
    ...otherIssues(s),
  ].sort(bySeverity);
  return { issues: all.filter((i) => i.severity !== "opportunity"), opportunities: all.filter((i) => i.severity === "opportunity") };
}

/* ------------------------------------------------- 7 · recommendations -- */

type RecRule = Omit<Recommendation, "id" | "merchant" | "href"> & { cta?: string };
const REC: Record<string, (n: number, first: IssueItem) => RecRule> = {
  "gbp.sync_failed": (n) => ({ confidence: "High", title: "Reconnect Google Business Profile", expectedImpact: `Restores daily numbers for ${plural(n, "listing")}`, measuredOn: "Data completeness", window: "Immediate  ·  blocking", blocking: true, cta: "Open integrations" }),
  "ads.sync_issue": (n) => ({ confidence: "High", title: "Fix the Google Ads sync", expectedImpact: `Restores spend and results for ${plural(n, "account")}`, measuredOn: "Data completeness", window: "Immediate  ·  blocking", blocking: true }),
  "ops.sla": (n) => ({ confidence: "High", title: `Clear ${plural(n, "ticket")} past SLA`, expectedImpact: "Back within the promised response time", measuredOn: "SLA compliance", window: "Today" }),
  "gbp.verification_required": (n, f) => ({ confidence: "High", title: n === 1 ? `Verify ${f.merchant} with Google` : `Verify ${n} listings with Google`, expectedImpact: "Keeps the listings visible on Search and Maps", measuredOn: "Verification status", window: "7 days" }),
  "ads.verification_required": (n, f) => ({ confidence: "High", title: n === 1 ? `Complete advertiser verification for ${f.merchant}` : `Complete advertiser verification for ${n} accounts`, expectedImpact: "Ads keep serving", measuredOn: "Verification status", window: "Before Google's deadline" }),
  "ads.unprofitable": (n, f) => ({ confidence: "Medium", title: n === 1 ? `Review the campaigns for ${f.merchant}` : `Review campaigns for ${n} unprofitable accounts`, expectedImpact: "Bring ROAS above break-even (1.0)", measuredOn: "ROAS", window: "30 days" }),
  "ads.budget_mismatch": (n, f) => ({ confidence: "High", title: n === 1 ? `Align the Google budget for ${f.merchant}` : `Align Google budgets for ${n} accounts`, expectedImpact: "Spend lands on the approved monthly budget", measuredOn: "Month-to-date spend vs approved", window: "This month" }),
  "gbp.unanswered_reviews": (n, f) => ({ confidence: "Medium", title: n === 1 ? `Reply to the reviews at ${f.merchant}` : `Reply to reviews at ${n} listings`, expectedImpact: "Better rating and response rate", measuredOn: "Reply rate", window: "7 days" }),
  "gbp.low_profile": (n, f) => ({ confidence: "Medium", title: n === 1 ? `Complete the Google profile for ${f.merchant}` : `Complete ${n} Google profiles`, expectedImpact: "More profile views and actions", measuredOn: "Profile completion", window: "14 days" }),
  "gbp.stale_posts": () => ({ confidence: "Medium", title: "Publish fresh Google posts", expectedImpact: "More profile views and actions", measuredOn: "GBP actions", window: "30 days" }),
  "ads.strong_roas": (n, f) => ({ confidence: "Medium", title: n === 1 ? `Consider more budget for ${f.merchant}` : `Consider more budget for ${n} strong accounts`, expectedImpact: "More orders at a proven return", measuredOn: "Ad-driven orders", window: "30 days" }),
};

/** Module list page for a rule that matched several items. */
const listHref = (code: string) =>
  code.startsWith("gbp.") ? "/web/gbp" : code.startsWith("ads.") ? "/ads" : code.startsWith("ops.") ? "/ops/tickets" : "/data-quality";

export function liveRecommendations(items: IssueItem[], max = 5): Recommendation[] {
  const groups = new Map<string, IssueItem[]>();
  for (const i of items) if (i.code && REC[i.code]) groups.set(i.code, [...(groups.get(i.code) ?? []), i]);
  const out: Recommendation[] = [];
  for (const [code, list] of groups) {
    const first = list[0];
    const rule = REC[code](list.length, first);
    const single = list.length === 1;
    out.push({
      id: `rec-${code}`,
      merchant: single ? first.merchant : "Portfolio",
      href: code === "gbp.sync_failed" ? "/settings/integrations" : single ? first.href : listHref(code),
      ...rule,
    });
    if (out.length >= max) break;
  }
  return out;
}

/* -------------------------------------------------- 8 · portfolio health -- */

const GBP_CRITICAL = new Set(["sync_failed", "verification_required", "temporarily_closed"]);
const GBP_ATTENTION = new Set(["data_delayed", "zero_calls", "unanswered_reviews", "verification_pending"]);

export function liveHealth(s: LiveSources): ModuleHealth[] {
  const out: ModuleHealth[] = [];
  const ov = s.gbp.overview;
  if (ov) {
    const flags = new Map(ov.attention.map((a) => [a.location.id, a.flags.map((f) => f.code)]));
    const h = { healthy: 0, needAttention: 0, critical: 0 };
    const rv = { healthy: 0, needAttention: 0, critical: 0 };
    for (const r of ov.rows as OverviewRow[]) {
      const codes = flags.get(r.id) ?? [];
      if (codes.some((c) => GBP_CRITICAL.has(c))) h.critical++;
      else if (codes.some((c) => GBP_ATTENTION.has(c))) h.needAttention++;
      else h.healthy++;
      if (r.rating != null) {
        if (r.rating >= 4.2) rv.healthy++;
        else if (r.rating >= 3.8) rv.needAttention++;
        else rv.critical++;
      }
    }
    out.push({ module: "GBP listings", href: "/web/gbp", ...h });
    out.push({ module: "Reviews", href: "/web/gbp", labels: ["rated 4.2+", "rated 3.8–4.2", "below 3.8"], ...rv });
  }
  if (s.ads.now) {
    const h = { healthy: 0, needAttention: 0, critical: 0 };
    for (const r of activeAds(s.ads.now)) {
      const types = r.alerts.map((a) => a.type);
      if (types.includes("sync_issue") || types.includes("verification_required") || (r.roasStatus.key === "unprofitable" && r.metrics.spend > 0)) h.critical++;
      else if (types.includes("budget_mismatch") || r.roasStatus.key === "breakeven") h.needAttention++;
      else h.healthy++;
    }
    out.push({ module: "Ads accounts", href: "/ads", ...h });
  }
  if (ov || s.ads.now) {
    const d = { healthy: 0, needAttention: 0, critical: 0 };
    for (const r of ov?.rows ?? []) {
      if (r.syncState === "failed") d.critical++;
      else if (r.syncState === "delayed") d.needAttention++;
      else d.healthy++;
    }
    for (const r of activeAds(s.ads.now)) {
      if (r.syncState === "issue") d.critical++;
      else if (r.syncState === "never") d.needAttention++;
      else d.healthy++;
    }
    out.push({ module: "Data syncs", href: "/settings/integrations", labels: ["up to date", "delayed", "failing"], ...d });
  }
  const dq = s.dataQuality;
  if (dq) out.push({ module: "Merchant profiles", href: "/data-quality", labels: ["complete", "partial", "critical"], healthy: dq.bands.complete, needAttention: dq.bands.partial, critical: dq.bands.critical });
  const t = s.tickets;
  if (t.open != null) {
    const breached = t.slaBreached ?? 0;
    const overdue = t.overdue ?? 0;
    out.push({ module: "Open tickets", href: "/ops/tickets", labels: ["on time", "overdue", "past SLA"], healthy: Math.max(0, t.open - Math.max(overdue, breached)), needAttention: overdue, critical: breached });
  }
  return out;
}

export function liveCollapsed(s: LiveSources, issueCount: number): CollapsedSection[] {
  const out: CollapsedSection[] = [];
  const items: { label: string; value: string; href?: string }[] = [];
  for (const t of s.gbp.overview?.topPerformers ?? []) {
    if (t.location && t.value != null) items.push({ label: `${t.label} · ${t.location.title}`, value: fmtInt(t.value), href: gbpHref(t.location.id) });
  }
  const best = activeAds(s.ads.now)
    .filter((r) => r.roas != null && r.metrics.spend > 0)
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))
    .slice(0, 3);
  for (const r of best) items.push({ label: `Best ROAS · ${merchantName(r)}`, value: `${r.roas!.toFixed(2)}×`, href: adsHref(r.id) });
  if (items.length)
    out.push({ key: "performing", title: "Performing Well", summary: items.slice(0, 2).map((i) => `${i.label.split(" · ")[1]} ${i.value}`).join("  ·  "), items });
  const mods: string[] = [];
  if (s.gbp.overview) mods.push(plural(s.gbp.overview.summary.total, "GBP listing"));
  if (s.ads.now) mods.push(plural(s.ads.now.counts.all, "Ads account"));
  if (s.tickets.open != null) mods.push(plural(s.tickets.open, "open ticket"));
  if (mods.length)
    out.push({
      key: "modules",
      title: "Module summaries",
      summary: `${mods.join("  ·  ")}  ·  ${plural(issueCount, "item")} need attention`,
      items: [
        ...(s.gbp.overview ? [{ label: "GBP · open listings", value: fmtInt(s.gbp.overview.summary.open), href: "/web/gbp" }, { label: "GBP · sync issues", value: fmtInt(s.gbp.overview.summary.syncIssues), href: "/web/gbp" }] : []),
        ...(s.ads.now ? [{ label: "Ads · active accounts", value: fmtInt(s.ads.now.counts.active), href: "/ads" }, { label: "Ads · budget mismatch", value: fmtInt(s.ads.now.counts.budgetMismatch), href: "/ads" }] : []),
        ...(s.tickets.open != null ? [{ label: "Tickets · open", value: fmtInt(s.tickets.open), href: "/ops/tickets" }] : []),
      ],
    });
  return out;
}

/* ------------------------------------------------------ 2 · MIA summary -- */

export function liveSummary(s: LiveSources, issues: IssueItem[]): { confidence: "High" | "Medium" | "Low"; segments: SummarySegment[] } | null {
  const seg: SummarySegment[] = [];
  const ov = s.gbp.overview;
  const now = adsTotals(s.ads.now);
  const prev = adsTotals(s.ads.prev);
  if (!ov && !now) return null;
  const word = (d: { trend: Trend; delta: string }) => (d.trend === "flat" ? "flat" : `${d.trend} ${d.delta}`);
  if (ov) {
    const d = delta(ov.totals.total.current, ov.totals.total.previous);
    seg.push({ text: `Google Business actions are ${word(d)} at ` }, { text: fmtInt(ov.totals.total.current), href: "/web/gbp" });
    seg.push({ text: ` over the last ${s.days} days, from ${fmtInt(ov.totals.views.current)} profile views and ${fmtInt(ov.totals.calls.current)} calls across ${plural(ov.summary.total, "listing")}. ` });
  }
  if (now) {
    const d = delta(now.spend, prev?.spend);
    seg.push({ text: "Google Ads spent " }, { text: fmtMoney(now.spend), href: "/ads" });
    seg.push({ text: ` (${word(d)}) for ${fmtInt(now.clicks)} clicks${now.roas != null ? `, a return of ${now.roas.toFixed(2)}× on spend` : ""}. ` });
  }
  const critical = issues.filter((i) => i.severity === "critical").length;
  const high = issues.filter((i) => i.severity === "high").length;
  if (issues.length) {
    seg.push({ text: `${plural(issues.length, "item")} need attention` });
    seg.push({ text: critical || high ? ` — ${[critical && `${critical} critical`, high && `${high} high`].filter(Boolean).join(", ")}; the top one is ` : ". The top one is " });
    seg.push({ text: issues[0].title, href: issues[0].href }, { text: ". " });
  } else {
    seg.push({ text: "Nothing needs attention right now. " });
  }
  const demo = sampleFlags(s);
  const late = (ov?.summary.syncIssues ?? 0) + (s.ads.now?.counts.syncIssue ?? 0);
  if (late) seg.push({ text: `${plural(late, "data source")} are behind`, href: "/settings/integrations" }, { text: ", so some numbers may be understated." });
  if (demo.gbp || demo.ads) seg.push({ text: ` ${[demo.gbp && "GBP", demo.ads && "Ads"].filter(Boolean).join(" and ")} figures are sample data until the Google accounts are connected.` });
  const confidence = demo.gbp || demo.ads ? "Low" : late || !ov || !now ? "Medium" : "High";
  return { confidence, segments: seg };
}
