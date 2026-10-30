/**
 * Command Center (Home) — typed mock data mirroring the Figma
 * "Home / Command Center — Light" (Super-Admin-App · node 7:90).
 *
 * Every section below maps to one future API read; the shapes are the
 * contract the screen renders from, so swapping to TanStack Query hooks is a
 * matter of returning these types from the fetchers.
 */

export type Trend = "up" | "down" | "flat";
export type Severity = "critical" | "high" | "medium" | "low" | "data" | "opportunity";
/** Sample modules plus the live ones (GBP, Profiles, Ops). */
export type ModuleKey = "Orders" | "Guests" | "SEO & GBP" | "GBP" | "Email & SMS" | "Ads" | "Reviews" | "Billing" | "Data" | "Profiles" | "Ops";

export const PORTFOLIO_SCOPE = { label: "My accounts", merchantCount: 22 };
export const DATE_RANGE = { label: "Last 30 days", comparison: "previous period" };

/* 1 · Data & Integrations ------------------------------------------------ */
export interface IntegrationHealth {
  healthy: number;
  delayed: number;
  error: number;
  notConfigured: number;
}
export const INTEGRATIONS: IntegrationHealth = { healthy: 18, delayed: 2, error: 1, notConfigured: 1 };

/* 2 · MIA executive summary ---------------------------------------------- */
export type SummarySegment = { text: string; href?: string };
export const MIA_SUMMARY: { confidence: "High" | "Medium" | "Low"; segments: SummarySegment[] } = {
  confidence: "Medium",
  segments: [
    { text: "Portfolio sales are down 6% to " },
    { text: "$482,300", href: "/reports" },
    { text: ", with most of the decline concentrated in " },
    { text: "Cairo Grill", href: "/merchants" },
    { text: " and " },
    { text: "Taco Libre", href: "/merchants" },
    { text: ". Orders fell 3% while new guests rose 8%, so acquisition is holding and the weakness is in repeat behaviour — repeat rate is " },
    { text: "down 4 points to 31%", href: "/guests" },
    { text: ". Organic clicks are " },
    { text: "up 12%", href: "/web/seo" },
    { text: " and GBP actions up 5%, so visibility is not the constraint this period. " },
    { text: "Two data sources are delayed and one errored", href: "/settings" },
    { text: ", which may understate Orders for Blue Fig Cafe." },
  ],
};

/* 3 · Core KPIs ------------------------------------------------------------ */
export interface Kpi {
  key: string;
  label: string;
  value: string;
  delta: string;
  trend: Trend;
  /** Whether "up" is the good direction (false for e.g. cost metrics). */
  upIsGood?: boolean;
  compare: string;
  /** Daily points for the sparkline; when empty the card draws a current-vs-previous bar instead. */
  spark: number[];
  /** Raw numbers for the comparison bar (live KPIs). */
  current?: number | null;
  previous?: number | null;
  /** Where the card links to. */
  href?: string;
  /** One-line explanation shown on the info icon. */
  hint?: string;
  /** Data comes from sample records. */
  isDemo?: boolean;
}
export const KPIS: Kpi[] = [
  { key: "sales", label: "Merchant Sales", value: "$482,300", delta: "6%", trend: "down", compare: "vs $513,100", spark: [62, 58, 64, 60, 55, 57, 52, 50, 54, 48, 46, 44] },
  { key: "orders", label: "Orders", value: "9,140", delta: "3%", trend: "down", compare: "vs 9,420", spark: [50, 52, 49, 53, 51, 48, 50, 47, 49, 46, 48, 45] },
  { key: "guests", label: "New Guests", value: "1,204", delta: "8%", trend: "up", compare: "vs 1,115", spark: [40, 42, 41, 45, 44, 48, 47, 50, 52, 51, 55, 58] },
  { key: "repeat", label: "Repeat Rate", value: "31%", delta: "4 pts", trend: "down", compare: "vs 35%", spark: [58, 57, 56, 55, 53, 52, 50, 49, 48, 47, 46, 44] },
  { key: "clicks", label: "Organic Clicks", value: "18,900", delta: "12%", trend: "up", compare: "vs 16,875", spark: [38, 40, 42, 41, 45, 47, 46, 50, 52, 54, 57, 60] },
  { key: "gbp", label: "GBP Actions", value: "6,410", delta: "5%", trend: "up", compare: "vs 6,105", spark: [44, 45, 44, 47, 46, 48, 49, 48, 51, 52, 53, 55] },
];

/* 4 · Needs Attention / 6 · Opportunities ---------------------------------- */
export interface IssueItem {
  id: string;
  severity: Severity;
  module: ModuleKey;
  status: "Open" | "Monitor";
  title: string;
  merchant: string;
  location: string;
  impact: string;
  /** Sample cards carry an owner; live cards show `cta` instead. */
  owner?: { name: string; initials: string };
  cta?: string;
  href: string;
  /** Rule that raised it, e.g. "gbp.verification_required" (live only). */
  code?: string;
  isDemo?: boolean;
}
export const ISSUES: IssueItem[] = [
  { id: "i1", severity: "critical", module: "Data", status: "Open", title: "Orders feed disconnected for Blue Fig Cafe", merchant: "Blue Fig Cafe", location: "Marina", impact: "No orders tracked since 2 Sep", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/issues" },
  { id: "i2", severity: "high", module: "Guests", status: "Open", title: "Repeat rate down 14% vs previous 30 days", merchant: "Cairo Grill", location: "Downtown", impact: "~$3,900 monthly revenue at risk", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/issues" },
  { id: "i3", severity: "high", module: "Orders", status: "Open", title: "Sales down 11% week over week", merchant: "Taco Libre", location: "Westside", impact: "~$2,750 monthly revenue at risk", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/issues" },
  { id: "i4", severity: "high", module: "Reviews", status: "Open", title: "Average rating fell to 3.9 from 4.4", merchant: "Saffron House", location: "Old Town", impact: "18 unanswered reviews in 30 days", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/issues" },
  { id: "i5", severity: "medium", module: "SEO & GBP", status: "Open", title: "Dropped to position 8 for “best shawarma”", merchant: "Nonna’s Kitchen", location: "Riverside", impact: "~1,100 organic clicks per month at risk", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/issues" },
  { id: "i6", severity: "data", module: "Data", status: "Monitor", title: "GA4 sync delayed 26 hours", merchant: "4 merchants affected", location: "", impact: "Traffic KPIs may be understated", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/issues" },
  { id: "i7", severity: "medium", module: "Email & SMS", status: "Open", title: "Campaign open rate down 9 pts", merchant: "Blue Fig Cafe", location: "Marina", impact: "2,400 recipients under-engaged", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/issues" },
  { id: "i8", severity: "low", module: "Billing", status: "Open", title: "3 delivered services unbilled for 2 months", merchant: "Taco Libre", location: "Westside", impact: "~$540 unbilled revenue", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/issues" },
];
export const OPPORTUNITIES: IssueItem[] = [
  { id: "o1", severity: "opportunity", module: "Guests", status: "Open", title: "1,840 inactive guests with no campaign in 90 days", merchant: "Portfolio", location: "9 merchants", impact: "~$14,200 recoverable revenue", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/guests" },
  { id: "o2", severity: "opportunity", module: "SEO & GBP", status: "Open", title: "Ranking 4–10 for 12 high-intent keywords", merchant: "6 merchants", location: "", impact: "~3,400 organic clicks per month available", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/web/seo" },
  { id: "o3", severity: "opportunity", module: "Billing", status: "Open", title: "3 services delivered but never billed", merchant: "Taco Libre", location: "Westside", impact: "~$540 recoverable this cycle", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/payments" },
  { id: "o4", severity: "opportunity", module: "Reviews", status: "Open", title: "Rating below 4.2 with no response workflow", merchant: "Saffron House", location: "Old Town", impact: "Rating recovery within 60 days", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/reviews" },
  { id: "o5", severity: "opportunity", module: "SEO & GBP", status: "Open", title: "Google Business profile incomplete for 2 locations", merchant: "Nonna’s Kitchen", location: "Riverside", impact: "~800 GBP actions per month available", owner: { name: "Maha Ibrahim", initials: "MI" }, href: "/web/gbp" },
];

/** Open "Needs Attention" items — drives the Home link and the sidebar pill. */
export const OPEN_ISSUES_COUNT = ISSUES.length;

/* 5 · What Changed ---------------------------------------------------------- */
export type ChangeStatus = "Measuring" | "Confirmed" | "Review";
export interface ChangeItem {
  id: string;
  title: string;
  status: ChangeStatus;
  owner: string;
  date: string;
  module: ModuleKey;
  expected: string;
  result: string;
}
export const CHANGES: ChangeItem[] = [
  { id: "c1", title: "Win-back campaign sent to 480 inactive guests", status: "Measuring", owner: "Maha Ibrahim", date: "12 Sep", module: "Email & SMS", expected: "repeat rate +3 pts", result: "measuring until 30 Sep" },
  { id: "c2", title: "Menu prices increased 6% across 12 items", status: "Confirmed", owner: "Omar Khaled", date: "8 Sep", module: "Orders", expected: "AOV +4%", result: "AOV +5.2%" },
  { id: "c3", title: "Google Business hours updated for 3 locations", status: "Confirmed", owner: "Maha Ibrahim", date: "5 Sep", module: "SEO & GBP", expected: "GBP actions +8%", result: "GBP actions +5%" },
  { id: "c4", title: "Google Ads budget reduced 30%", status: "Review", owner: "Sara Nabil", date: "1 Sep", module: "Ads", expected: "CPA −10%", result: "clicks −22%" },
  { id: "c5", title: "Review response SLA set to 24 hours", status: "Measuring", owner: "Maha Ibrahim", date: "28 Aug", module: "Reviews", expected: "rating +0.2", result: "measuring until 27 Sep" },
  { id: "c6", title: "Loyalty tier thresholds lowered", status: "Confirmed", owner: "Omar Khaled", date: "25 Aug", module: "Guests", expected: "repeat rate +2 pts", result: "repeat rate +0.4 pts" },
];

/* 7 · Recommended Actions --------------------------------------------------- */
export interface Recommendation {
  id: string;
  merchant: string;
  confidence: "High" | "Medium" | "Low";
  title: string;
  expectedImpact: string;
  measuredOn: string;
  window: string;
  /** "blocking" renders the window in the destructive text colour. */
  blocking?: boolean;
  href: string;
  /** Label of the primary button (default "Open in module"). */
  cta?: string;
}
export const RECOMMENDATIONS: Recommendation[] = [
  { id: "r1", merchant: "Cairo Grill", confidence: "Medium", title: "Win-back campaign to Inactive Guests", expectedImpact: "+3 pts repeat rate over 30 days", measuredOn: "Repeat-order rate", window: "30 days  ·  until 30 Sep", href: "/marketing/email-sms" },
  { id: "r2", merchant: "Blue Fig Cafe", confidence: "High", title: "Reconnect the Orders feed", expectedImpact: "Restores order tracking from 2 Sep", measuredOn: "Data completeness", window: "Immediate  ·  blocking", blocking: true, href: "/settings" },
  { id: "r3", merchant: "Nonna’s Kitchen", confidence: "Medium", title: "Publish 4 GBP posts for “best shawarma”", expectedImpact: "+600 organic clicks per month", measuredOn: "Organic clicks", window: "45 days  ·  until 19 Oct", href: "/web/gbp" },
  { id: "r4", merchant: "Saffron House", confidence: "Medium", title: "Enable the review response workflow", expectedImpact: "+0.3 average rating", measuredOn: "Average rating", window: "60 days  ·  until 3 Nov", href: "/reviews" },
  { id: "r5", merchant: "Taco Libre", confidence: "High", title: "Bill 3 outstanding delivered services", expectedImpact: "+$540 recovered this cycle", measuredOn: "Billed revenue", window: "14 days  ·  until 18 Sep", href: "/payments" },
];

/* 8 · Portfolio health ------------------------------------------------------ */
export interface ModuleHealth {
  module: string;
  href?: string;
  /** Overrides for the three row labels (e.g. "on time" / "overdue" / "past SLA"). */
  labels?: [string, string, string];
  healthy: number;
  needAttention: number;
  critical: number;
}
export const PORTFOLIO_HEALTH: ModuleHealth[] = [
  { module: "Orders", healthy: 17, needAttention: 4, critical: 1 },
  { module: "Guests", healthy: 15, needAttention: 6, critical: 1 },
  { module: "SEO & GBP", healthy: 18, needAttention: 4, critical: 0 },
  { module: "Email & SMS", healthy: 20, needAttention: 2, critical: 0 },
  { module: "Ads", healthy: 14, needAttention: 7, critical: 1 },
  { module: "Reviews", healthy: 16, needAttention: 5, critical: 1 },
  { module: "Billing", healthy: 19, needAttention: 3, critical: 0 },
  { module: "Data", healthy: 18, needAttention: 2, critical: 2 },
];
export interface CollapsedSection {
  key: string;
  title: string;
  summary: string;
  items?: { label: string; value: string; href?: string }[];
}
export const COLLAPSED_SECTIONS: CollapsedSection[] = [
  { key: "performing", title: "Performing Well", summary: "6 merchants above plan  ·  Nonna’s Kitchen leads at +14% sales" },
  { key: "modules", title: "Module summaries", summary: "7 modules  ·  Ads has the most issues (8)" },
];
