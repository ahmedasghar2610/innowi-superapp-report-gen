import type { BadgeTone } from "@/components/ui";
import type { Alert, Kpis, PortfolioRow, RestaurantStatus, RoasKey, SyncState, Verification } from "./types";

export { downloadCsv } from "@/features/gbp/lib";

/* ----------------------------------------------------------- numbers ---- */
export const NA = "N/A";

/** $1,792 for large amounts, $10.86 for small ones (prototype style). */
export function fmtMoney(v: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (v == null) return "—";
  const cents = opts.cents ?? Math.abs(v) < 1000;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}

/** $23.9k / $1.2M for tiles. */
export function fmtMoneyShort(v: number | null | undefined): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 10_000) return `$${(v / 1000).toFixed(1)}k`;
  return fmtMoney(v, { cents: a < 100 });
}

export function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function fmtShort(v: number | null | undefined): string {
  if (v == null) return "—";
  return Math.abs(v) >= 10_000 ? `${(v / 1000).toFixed(1)}k` : fmtNum(v);
}

export const fmtPct = (v: number | null | undefined) => (v == null ? NA : `${Math.round(v).toLocaleString("en-US")}%`);
export const fmtRoas = (v: number | null | undefined) => (v == null ? NA : `${v.toFixed(1)}x`);
export const fmtSignedMoney = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtMoney(Math.abs(v))}`);
export const fmtSignedPct = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

/* ------------------------------------------------------------- dates ---- */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => isoOf(new Date(day(iso).getTime() + n * 86400000));
export const fmtDay = (iso: string | null | undefined, year = true) =>
  iso ? day(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }) : "—";
export const fmtMonth = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
export function fmtRange(start: string, end: string): string {
  if (start === end) return fmtDay(start);
  return `${fmtDay(start, start.slice(0, 4) !== end.slice(0, 4))} – ${fmtDay(end)}`;
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} — ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
export const autoTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** Today in the viewer's own calendar (not UTC). */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ----------------------------------------------------------- periods ---- */
export type PeriodKey = "report" | "this-month" | "last-week" | "today" | "yesterday" | "7d" | "30d" | "day" | "custom";

export interface PeriodState {
  key: PeriodKey;
  start?: string;
  end?: string;
}

export const PERIOD_PRESETS: { key: Exclude<PeriodKey, "day" | "custom">; label: string }[] = [
  { key: "report", label: "Report month" },
  { key: "this-month", label: "This month" },
  { key: "last-week", label: "Last week (Mon–Sun)" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
];

/** The previous calendar month — what the n8n monthly run reported. */
export function reportMonth(today = localToday()): { start: string; end: string } {
  const first = `${today.slice(0, 7)}-01`;
  const end = addDays(first, -1);
  return { start: `${end.slice(0, 7)}-01`, end };
}

export function resolvePeriod(p: PeriodState, today = localToday()): { start?: string; end?: string } {
  switch (p.key) {
    case "report":
      return reportMonth(today);
    case "this-month":
      return { start: `${today.slice(0, 7)}-01`, end: today };
    case "last-week": {
      const dow = (day(today).getUTCDay() + 6) % 7; // Monday = 0
      const monday = addDays(today, -dow - 7);
      return { start: monday, end: addDays(monday, 6) };
    }
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { start: y, end: y };
    }
    case "7d":
      return { start: addDays(today, -7), end: addDays(today, -1) };
    case "30d":
      return { start: addDays(today, -30), end: addDays(today, -1) };
    case "day":
      return { start: p.start, end: p.start };
    case "custom":
      return { start: p.start, end: p.end };
  }
}

export function periodLabel(p: PeriodState, today = localToday()): string {
  const r = resolvePeriod(p, today);
  if (p.key === "report") return `${fmtMonth(r.start!.slice(0, 7))} (report period)`;
  const preset = PERIOD_PRESETS.find((x) => x.key === p.key);
  if (preset && r.start && r.end) return `${preset.label} · ${fmtRange(r.start, r.end)}`;
  return r.start && r.end ? fmtRange(r.start, r.end) : "Pick dates";
}

export function periodFromParams(p: URLSearchParams): PeriodState {
  const key = (p.get("period") as PeriodKey) || "report";
  if (key === "custom" || key === "day") return { key, start: p.get("start") ?? undefined, end: p.get("end") ?? undefined };
  return { key: PERIOD_PRESETS.some((x) => x.key === key) ? key : "report" };
}

export function periodToParams(p: PeriodState): Record<string, string> {
  if (p.key === "custom" && p.start && p.end) return { period: "custom", start: p.start, end: p.end };
  if (p.key === "day" && p.start) return { period: "day", start: p.start };
  return { period: p.key };
}

/* -------------------------------------------------------- comparison ---- */
/** Change vs the comparison period (same shape as the GBP module's). */
export type Change = { kind: "pct"; value: number } | { kind: "new" } | { kind: "flat" } | { kind: "na" };
/** Which direction is good news: spend going up is neither good nor bad; cost per order going up is bad. */
export type Better = "up" | "down" | "none";

export function change(cur: number | null | undefined, prev: number | null | undefined): Change {
  if (cur == null || prev == null) return { kind: "na" };
  if (prev === 0) return cur === 0 ? { kind: "flat" } : { kind: "new" };
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return { kind: "pct", value: Math.abs(pct) < 10 ? Math.round(pct * 10) / 10 : Math.round(pct) };
}

export function changeText(c: Change, suffix = ""): string {
  if (c.kind === "na") return "No earlier data";
  if (c.kind === "flat") return `No activity either period`;
  if (c.kind === "new") return `New${suffix}`;
  if (c.value === 0) return `No change${suffix}`;
  return `${c.value > 0 ? "▲" : "▼"} ${Math.abs(c.value).toLocaleString("en-US")}%${suffix}`;
}

export function changeTone(c: Change, better: Better): "good" | "bad" | "none" {
  if (better === "none" || c.kind === "na" || c.kind === "flat") return "none";
  const dir = c.kind === "new" ? 1 : Math.sign(c.value);
  if (dir === 0) return "none";
  return (dir > 0) === (better === "up") ? "good" : "bad";
}

/** CSV cell: "+12.5%", "new", "" when there is nothing to compare. */
export function changeCsv(cur: number | null | undefined, prev: number | null | undefined): string {
  const c = change(cur, prev);
  return c.kind === "pct" ? `${c.value > 0 ? "+" : ""}${c.value}%` : c.kind === "new" ? "new" : "";
}

/* ------------------------------------------------------------ labels ---- */
export const RESTAURANT_STATUS: Record<RestaurantStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  no_campaigns: { label: "No campaigns", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },
};

export const VERIFICATION: Record<Verification, { label: string; tone: BadgeTone }> = {
  verified: { label: "Verified", tone: "success" },
  required: { label: "Required", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  pending: { label: "In review", tone: "accent" },
  not_required: { label: "Not required", tone: "neutral" },
  unknown: { label: "Unknown", tone: "neutral" },
};

export const SYNC: Record<SyncState, { label: string; tone: BadgeTone }> = {
  ok: { label: "Synced", tone: "success" },
  issue: { label: "Sync Issue", tone: "danger" },
  never: { label: "Not synced yet", tone: "neutral" },
};

/** n8n's ROAS status bands (≥4 Excellent, ≥2.5 Good, ≥1 Break-even, <1 Unprofitable). */
export const ROAS: Record<RoasKey, { tone: BadgeTone; text: string }> = {
  excellent: { tone: "success", text: "text-success-subtle-foreground" },
  good: { tone: "success", text: "text-success-subtle-foreground" },
  breakeven: { tone: "warning", text: "text-warning-text" },
  unprofitable: { tone: "danger", text: "text-text-destructive" },
  na: { tone: "neutral", text: "text-muted-foreground" },
};

export const ALERT_TONE: Record<Alert["type"], BadgeTone> = {
  budget_mismatch: "warning",
  verification_required: "danger",
  sync_issue: "danger",
};

export const CAMPAIGN_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  ENABLED: { label: "Active", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  REMOVED: { label: "Removed", tone: "neutral" },
  UNKNOWN: { label: "Unknown", tone: "neutral" },
};

export function channelLabel(t: string | null | undefined): string {
  if (!t) return "—";
  if (t === "PERFORMANCE_MAX") return "Performance Max";
  return t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " ");
}

/* ------------------------------------------------------------ totals ---- */
/**
 * Portfolio totals over the rows on screen. Revenue only exists for
 * restaurants with an average ticket size, so ROI / ROAS use the spend of
 * those same restaurants — a restaurant without a ticket never drags them down.
 */
export function portfolioTotals(rows: PortfolioRow[]) {
  let spend = 0,
    orders = 0,
    revenue = 0,
    spendWithRevenue = 0,
    withRevenue = 0;
  for (const r of rows) {
    spend += r.metrics.spend;
    orders += r.metrics.orders;
    if (r.revenue != null) {
      revenue += r.revenue;
      spendWithRevenue += r.metrics.spend;
      withRevenue += 1;
    }
  }
  const kpis: Kpis = {
    revenue: withRevenue ? revenue : null,
    costPerOrder: orders > 0 ? spend / orders : null,
    roi: spendWithRevenue > 0 ? ((revenue - spendWithRevenue) / spendWithRevenue) * 100 : null,
    roas: spendWithRevenue > 0 ? revenue / spendWithRevenue : null,
  };
  return { spend, orders, withRevenue, withoutRevenue: rows.length - withRevenue, ...kpis };
}
