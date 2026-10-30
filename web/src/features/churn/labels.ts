import type { BadgeTone } from "@/components/ui";
import type { MerchantStatus, WinbackStatus } from "./types";

export const WINBACK_LABEL: Record<WinbackStatus, string> = {
  NOT_STARTED: "Not started",
  CONTACTED: "Contacted",
  IN_TALKS: "In talks",
  WON_BACK: "Won back",
  DECLINED: "Declined",
  CLOSED_PERMANENTLY: "Closed for good",
};

export const WINBACK_TONE: Record<WinbackStatus, BadgeTone> = {
  NOT_STARTED: "neutral",
  CONTACTED: "accent",
  IN_TALKS: "warning",
  WON_BACK: "success",
  DECLINED: "danger",
  CLOSED_PERMANENTLY: "outline",
};

export const MERCHANT_STATUS_LABEL: Record<MerchantStatus, string> = {
  PROSPECT: "Prospect",
  ONBOARDING: "Onboarding",
  ACTIVE: "Active",
  PAUSED: "Paused",
  CHURNED: "Churned",
};

export const MERCHANT_STATUS_TONE: Record<MerchantStatus, BadgeTone> = {
  PROSPECT: "neutral",
  ONBOARDING: "accent",
  ACTIVE: "success",
  PAUSED: "warning",
  CHURNED: "danger",
};

/** "2026-07" → "Jul 2026" */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function money(v: string | number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts.compact ? 0 : 2,
    notation: opts.compact && Math.abs(n) >= 100000 ? "compact" : "standard",
  });
}

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A date-only value ("2026-08-03") shown as "Aug 3, 2026", whatever the viewer's time zone. */
export function formatDay(day?: string | null): string {
  if (!day) return "—";
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "—" : DAY.format(d);
}
