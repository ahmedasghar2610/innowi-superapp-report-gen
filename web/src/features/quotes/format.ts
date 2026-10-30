import type { BadgeTone } from "@/components/ui";
import type { QuoteMode, RequestStatus } from "./types";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "1234.5" → "$1,234.50"; empty → "—". Money comes from the API as a decimal string. */
export function usd(value?: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? USD.format(n) : "—";
}

/** True when `price` is below `list` (special pricing to show as a strike-through). */
export function isDiscounted(list?: string | null, price?: string | null): boolean {
  if (list == null || price == null) return false;
  return Number(price) < Number(list);
}

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  REQUESTED: "Request (needs pricing)",
  PROPOSED: "Proposal sent",
  ACCEPTED: "Accepted",
  SIGNED: "Signed — countersign",
  EXECUTED: "Fully signed",
  DECLINED: "Declined",
  CLOSED: "Closed",
};

export const REQUEST_STATUS_TONE: Record<RequestStatus, BadgeTone> = {
  REQUESTED: "warning",
  PROPOSED: "accent",
  ACCEPTED: "success",
  SIGNED: "warning",
  EXECUTED: "success",
  DECLINED: "danger",
  CLOSED: "neutral",
};

export const MODE_LABEL: Record<QuoteMode, string> = {
  SHOW_PRICES: "Prices shown",
  HIDE_PRICES: "Prices hidden",
};

export const SECTION_LABEL: Record<string, string> = {
  devices: "Stations and devices",
  hardware: "Printers and accessories",
  networking: "Networking",
  software: "Software add-ons",
  marketing: "Marketing package",
  services: "One-time services",
};
