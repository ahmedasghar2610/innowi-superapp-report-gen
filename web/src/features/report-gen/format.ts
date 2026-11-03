/**
 * How a report's figures are worded on screen.
 *
 * These rules mirror the PDF / DOCX exporter
 * (api/app/modules/report_gen/exports/shared.py) on purpose: a reviewer reads
 * the page, the merchant reads the file, and the two must not disagree about
 * what a number says. The unit map, the "not supplied" wording, the
 * modelled / tracked tag and the column labels below are all the same ones the
 * exporter uses.
 */
import type { Metric, Section } from "./types";

export const NOT_SUPPLIED = "Not supplied";
export const EMPTY = "—";

/** The attribution tags a figure may carry (MFR05). Anything else is ignored. */
export const TAGS: Record<string, string> = { modelled: "modelled", tracked: "tracked" };

export const TAG_NOTE: Record<string, string> = {
  modelled: "Modelled: worked out from tracked activity and the average ticket on file, not a figure taken from the till.",
  tracked: "Tracked: counted by the platform that served the activity.",
};

const num = (v: number, digits = 0) => v.toLocaleString("en-US", { maximumFractionDigits: digits });

export function money(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: v % 1 ? 2 : 0 })}`;
}

/** The payload keeps rates as fractions (0.048); the page prints 4.8%. */
export function percent(v: number): string {
  return `${num(v * 100, 1)}%`;
}

export function unitText(v: number | null, unit: string | null | undefined): string {
  if (v === null || v === undefined) return EMPTY;
  switch (unit) {
    case "usd":
      return money(v);
    case "pct":
      return percent(v);
    case "multiple":
      return `${num(v, 1)}×`;
    case "position":
    case "ratio":
      return num(v, 1);
    default:
      return num(v, 1);
  }
}

/** "+20%" / "-8%" on the month before. */
export function changeText(change: number | null): string {
  if (change === null || change === undefined) return EMPTY;
  return `${change >= 0 ? "+" : "-"}${Math.abs(change * 100).toFixed(0)}%`;
}

/** Whether a change reads as good, bad or flat. `lowerIsBetter` inverts it. */
export function changeTone(change: number | null, lowerIsBetter = false): "ok" | "danger" | "neutral" {
  if (change === null || change === undefined || Math.abs(change) < 0.005) return "neutral";
  const up = change > 0;
  return (lowerIsBetter ? !up : up) ? "ok" : "danger";
}

/** Figures where a fall is an improvement, so the change pill must not go red. */
const LOWER_IS_BETTER = /position|cost|refund|discount|optout|opt-out/i;
export function lowerIsBetter(m: Pick<Metric, "id" | "label">): boolean {
  return LOWER_IS_BETTER.test(m.label) || /^SEO04$/.test(m.id);
}

/** MFR04: the figure's slot says why it is absent — never a zero, never blank. */
export function notSuppliedText(reasonText: string | null): string {
  return reasonText ? `${NOT_SUPPLIED} — ${reasonText}` : NOT_SUPPLIED;
}

/** The figure's name, with its attribution tag where it has one (MFR05). */
export function metricLabel(m: Pick<Metric, "label" | "tag">): string {
  const tag = m.tag ? TAGS[m.tag] : undefined;
  return tag ? `${m.label} (${tag})` : m.label;
}

export function metricValue(m: Metric): string {
  if (m.value === null || m.value === undefined) return notSuppliedText(m.reasonText);
  // A "table" unit is a row count; the rows themselves are rendered below it.
  if (m.unit === "table") return `${num(m.value)} shown below`;
  return unitText(m.value, m.unit);
}

/** "September 30, 2026" from an ISO date, without a locale surprise. */
export function longDate(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/** "18 months of history" from the merchant's go-live date (MFR03's YoY gate). */
export function historyLine(goLiveDate: string | null): string {
  if (!goLiveDate) return "Not available";
  const start = new Date(`${goLiveDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime())) return "Not available";
  const now = new Date();
  const months = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()));
  const yoy = months >= 12 ? "year-on-year available" : "year-on-year starts at 12 months";
  return `${months} month${months === 1 ? "" : "s"} since go-live · ${yoy}`;
}

/** Initials for a merchant avatar: "Sage & Ember Kitchen" → "SE". */
export function initials(name: string): string {
  return (
    name
      .replace(/&/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/* ------------------------------------------------------- generic tables ---- */
/*
 * `Section.tables` is `Record<string, unknown>`: every adapter names its own
 * tables and the API does not type them. Rather than hard-code one component
 * per table, the renderer below reads the shape at runtime, the same way the
 * exporter does. A new adapter table therefore appears on the page with no
 * change here — only its heading would be unlabelled.
 */
export const COLUMN_LABELS: Record<string, string> = {
  query: "Search term",
  clicks: "Clicks",
  impressions: "Impressions",
  position: "Position",
  prevClicks: "Clicks last month",
  prevImpressions: "Impressions last month",
  prevPosition: "Position last month",
  prevCtr: "Click-through rate last month",
  page: "Page",
  device: "Device",
  campaign: "Campaign",
  spend: "Spend",
  orders: "Orders",
  roas: "Return on ad spend (modelled)",
  account: "Account",
  avgTicket: "Average ticket",
  asOf: "As of",
  action: "Action",
  value: "This month",
  prev: "Last month",
  title: "Title",
  url: "Address",
  publishedOn: "Published",
  openCount: "Open issues",
  fixedThisMonth: "Fixed this month",
  brandedShare: "Branded share of clicks",
  trackedClicks: "Clicks in tracked terms",
  trackedShareOfClicks: "Tracked share of clicks",
  shareOfSiteClicks: "Share of all site clicks",
  planned: "Planned",
  ctr: "Click-through rate",
  share: "Share",
};

/** Names of the adapter tables, for the heading above each grid. */
export const TABLE_LABELS: Record<string, string> = {
  topQueries: "Top searches",
  localQueries: "Local and near-me searches",
  topPages: "Top pages",
  devices: "By device",
  branded: "Branded vs non-branded",
  issues: "Site audit issues",
  topCampaigns: "Top campaigns",
  actions: "Actions from ads",
  tickets: "Average ticket on file",
  published: "Published this month",
  topPosts: "Top posts",
  totals: "Totals",
};

export function columnLabel(key: string): string {
  if (COLUMN_LABELS[key]) return COLUMN_LABELS[key];
  const words = key.replace(/(?<=[a-z0-9])(?=[A-Z])/g, " ").replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "branded ctr" → "Branded click-through rate". */
export function flatLabel(key: string): string {
  const i = key.lastIndexOf(" ");
  if (i < 0) return columnLabel(key);
  return `${columnLabel(key.slice(0, i))} ${columnLabel(key.slice(i + 1)).toLowerCase()}`;
}

export function tableLabel(key: string): string {
  return TABLE_LABELS[key] ?? columnLabel(key);
}

const MONEY_KEYS = ["spend", "cost", "revenue", "budget", "avgticket", "ticket"];
const RATE_KEYS = ["share", "rate", "ctr"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One table cell. The key decides the unit, so plain numbers print as money,
 *  a rate or a multiple exactly as the figures above them do. */
export function cellText(key: string, value: unknown): string {
  if (value === null || value === undefined) return EMPTY;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return ISO_DATE.test(value) ? longDate(value) : value;
  if (typeof value !== "number") return String(value);
  const k = key.toLowerCase();
  if (k.includes("roas")) return `${num(value, 1)}×`;
  if (k.includes("position")) return num(value, 1);
  if (RATE_KEYS.some((x) => k.includes(x))) return percent(value);
  if (MONEY_KEYS.some((x) => k.includes(x))) return money(value);
  return num(value, 1);
}

export function isNumericKey(value: unknown): boolean {
  return typeof value === "number" || value === null || value === undefined;
}

export type GridTable = { kind: "grid"; name: string; title: string; columns: string[]; rows: Record<string, unknown>[]; numeric: boolean[] };
export type PairTable = { kind: "pairs"; name: string; title: string; pairs: { label: string; value: string }[] };
export type RenderableTable = GridTable | PairTable;

function flatten(obj: Record<string, unknown>, prefix = ""): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...flatten(v as Record<string, unknown>, `${prefix}${k} `));
    else out.push([`${prefix}${k}`, v]);
  }
  return out;
}

/** Turn one named adapter table into something renderable, or null when empty. */
export function renderableTable(name: string, data: unknown): RenderableTable | null {
  if (!data) return null;
  const title = tableLabel(name);
  if (Array.isArray(data)) {
    const rows = data.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
    if (!rows.length) return null;
    const seen: string[] = [];
    for (const row of rows) for (const k of Object.keys(row)) if (!seen.includes(k)) seen.push(k);
    const isNum = (c: string) => rows.every((r) => isNumericKey(r[c]));
    // Lead with the label column, as the prototype's tables do. The API's
    // object-key order is an implementation detail of each adapter and puts the
    // text column last in some of them (actions, top campaigns, device split).
    // `filter` is stable, so the relative order inside each group is untouched.
    const columns = [...seen.filter((c) => !isNum(c)), ...seen.filter(isNum)];
    const numeric = columns.map(isNum);
    return { kind: "grid", name, title, columns, rows, numeric };
  }
  if (typeof data === "object") {
    const pairs = flatten(data as Record<string, unknown>)
      // `plannedReason` and friends are reason codes for a sibling field, not figures.
      .filter(([k]) => !k.toLowerCase().endsWith("reason"))
      .map(([k, v]) => ({ label: flatLabel(k), value: cellText(k.slice(k.lastIndexOf(" ") + 1), v) }));
    if (!pairs.length) return null;
    return { kind: "pairs", name, title, pairs };
  }
  return null;
}

export function sectionTables(s: Section): RenderableTable[] {
  return Object.entries(s.tables)
    .map(([k, v]) => renderableTable(k, v))
    .filter((t): t is RenderableTable => t !== null);
}

/** True when a taken section supplied no figure at all (MFR04's dashed box). */
export function sectionIsEmpty(s: Section): boolean {
  return s.metrics.length > 0 && s.metrics.every((m) => m.value === null);
}
