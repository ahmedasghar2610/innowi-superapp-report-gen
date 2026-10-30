import type { BadgeTone } from "@/components/ui";
import type { Cadence, FindingState, Package, ReportStatus, Severity, SourceState } from "./types";

export { downloadCsv, fmtAgo, fmtDay, fmtRange, autoTime } from "@/features/gbp/lib";

/* ----------------------------------------------------------- numbers ---- */
export const fmtNum = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));
export const fmtShort = (v: number | null | undefined) => (v == null ? "—" : Math.abs(v) >= 10_000 ? `${(v / 1000).toFixed(1)}k` : fmtNum(v));
export const fmtPct1 = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
/** Fractional change (0.12) → "+12%". */
export const fmtChange = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`);
export const changeOf = (cur: number | null | undefined, prev: number | null | undefined) =>
  cur == null || prev == null || prev === 0 ? null : (cur - prev) / prev;
export function changeClass(v: number | null | undefined, invert = false): string {
  if (v == null || Math.abs(v) < 0.005) return "text-muted-foreground";
  return (v > 0) !== invert ? "text-success-subtle-foreground" : "text-text-destructive";
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
export const fmtMonthIso = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "—";

/* ---------------------------------------------------------- grades ---- */
export function gradeOf(score: number | null | undefined): "A" | "B" | "C" | "D" | null {
  if (score == null) return null;
  return score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D";
}
/** Grade → badge tone and the text colour used for a bare number. */
export const GRADE: Record<"A" | "B" | "C" | "D", { tone: BadgeTone; text: string; bar: string }> = {
  A: { tone: "success", text: "text-success-subtle-foreground", bar: "bg-success" },
  B: { tone: "accent", text: "text-primary-subtle-foreground", bar: "bg-primary" },
  C: { tone: "warning", text: "text-warning-text", bar: "bg-warning" },
  D: { tone: "danger", text: "text-text-destructive", bar: "bg-destructive" },
};

/* -------------------------------------------------------- findings ---- */
export const SEVERITY: Record<Severity, { label: string; tone: BadgeTone; sla: string; hint: string }> = {
  S1: { label: "S1", tone: "danger", sla: "Same business day", hint: "Revenue or visibility is being lost now" },
  S2: { label: "S2", tone: "warning", sla: "Within 48 h", hint: "Will cost visibility if left" },
  S3: { label: "S3", tone: "neutral", sla: "Within a week", hint: "Hygiene / best practice" },
};
export const STATE: Record<FindingState, { label: string; tone: BadgeTone }> = {
  detected: { label: "Detected", tone: "neutral" },
  recommended: { label: "Recommended", tone: "accent" },
  task_created: { label: "Task created", tone: "accent" },
  in_progress: { label: "In progress", tone: "accent" },
  awaiting_verification: { label: "Awaiting verification", tone: "warning" },
  closed: { label: "Closed", tone: "success" },
};
export const OUTCOME = { fixed: "Fixed (verified)", resolved: "Cleared by itself", dismissed: "Dismissed" } as const;

/* --------------------------------------------------------- sources ---- */
export const SOURCE_STATE: Record<SourceState, { label: string; tone: BadgeTone }> = {
  connected: { label: "Connected", tone: "success" },
  pending: { label: "Pending", tone: "neutral" },
  error: { label: "Needs attention", tone: "danger" },
  sample: { label: "Sample data", tone: "dataq" },
  placeholder: { label: "Placeholder", tone: "outline" },
};

/* -------------------------------------------------------- packages ---- */
export const PACKAGE: Record<Package, { label: string; tone: BadgeTone }> = {
  normal: { label: "Normal", tone: "neutral" },
  "199": { label: "$199", tone: "warning" },
  "299": { label: "$299", tone: "accent" },
  internal: { label: "Internal", tone: "outline" },
};
export const CADENCE: Record<Cadence, string> = { biweekly: "Bi-weekly", monthly: "Monthly", quarterly: "Quarterly" };

/* --------------------------------------------------------- reports ---- */
export const REPORT_STATUS: Record<ReportStatus, { label: string; tone: BadgeTone }> = {
  awaiting_signoff: { label: "Awaiting sign-off", tone: "warning" },
  signed: { label: "Signed off", tone: "accent" },
  sent: { label: "Sent", tone: "success" },
  failed: { label: "Delivery failed", tone: "danger" },
};

/* ---------------------------------------------------------- pages ---- */
export const PAGE_TYPE: Record<string, string> = {
  home: "Home", hub: "Hub", category: "Category", dish: "Dish", geo: "Geo", combo: "Combo", blog: "Blog", other: "Other",
};

/** Weekly series ending on `end` → the date each week ends on (oldest first). */
export function weekEnds(end: string, weeks: number): string[] {
  const e = new Date(`${end}T00:00:00Z`).getTime();
  return Array.from({ length: weeks }, (_, i) => new Date(e - (weeks - 1 - i) * 7 * 86400000).toISOString().slice(0, 10));
}
