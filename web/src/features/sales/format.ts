import { formatDate } from "@/lib/format";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Salesforce "date" fields (close date, visit due date) arrive as "2026-10-11".
 * `new Date("2026-10-11")` is UTC midnight, which shows as Oct 10 anywhere west
 * of UTC — so date-only values are built in local time instead. Full ISO
 * timestamps fall through to the shared formatter.
 */
export function formatDay(value?: string | null): string {
  if (!value) return "—";
  const m = DATE_ONLY.exec(value);
  if (!m) return formatDate(value);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "3 minutes ago" / "2 hours ago" / "Oct 9" — for the last-synced line. */
export function formatAgo(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return formatDate(iso);
}

/** Lightning record page, e.g. https://innowi33.lightning.force.com/lightning/r/Opportunity/006.../view */
export function salesforceRecordUrl(base: string | null | undefined, sobject: string, id: string): string | null {
  if (!base) return null;
  return `${base}/lightning/r/${sobject}/${encodeURIComponent(id)}/view`;
}
