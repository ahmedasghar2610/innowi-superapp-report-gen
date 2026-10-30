/** Formatting helpers. */

/** Short human date from an ISO string; "—" when absent/invalid. */
export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Short human date + time from an ISO string; "—" when absent/invalid. */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Strip protocol / trailing slash for compact display of a URL. */
export function displayUrl(url?: string | null): string {
  if (!url) return "—";
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** UPPER_SNAKE enum → "Title Case" (e.g. "CONTENT_APPROVER" → "Content Approver"). */
export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * USD currency from the API's decimal-as-string amounts (e.g. subscription
 * `price` / `mrr`, "299.00"). Whole-dollar amounts drop the cents
 * ("$299" not "$299.00") to match the workbook's package labels; "—" when
 * absent or unparseable.
 */
export function formatUsd(amount?: string | number | null): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (Number.isNaN(n)) return "—";
  const isWhole = Number.isInteger(n);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 2,
  });
}
