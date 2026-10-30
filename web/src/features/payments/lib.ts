export function money(v: number | null | undefined, cents = false): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}

/** "2026-09-01" → "September 2026" */
export function monthLabel(iso: string | null | undefined, short = false): string {
  if (!iso) return "—";
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: short ? "short" : "long", year: "numeric", timeZone: "UTC" });
}

export function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
}
