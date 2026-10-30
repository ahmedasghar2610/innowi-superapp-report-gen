import type { BadgeTone } from "@/components/ui";
import type { TicketPriority, TicketRequestType, TicketStatus, TicketType } from "./types";

/** Display labels and tones for ticket enums. Translate enums only here. */

export const TYPE_LABEL: Record<TicketType, string> = {
  MARKETING: "Marketing",
  DESIGN: "Design",
  WEBSITE: "Website",
  INTERNAL: "Internal",
};
export const TYPE_ORDER: TicketType[] = ["MARKETING", "DESIGN", "WEBSITE", "INTERNAL"];
/** Small colour key per type, from the design-system chart palette. */
export const TYPE_DOT: Record<TicketType, string> = {
  MARKETING: "bg-chart-3",
  DESIGN: "bg-chart-4",
  WEBSITE: "bg-chart-1",
  INTERNAL: "bg-muted-foreground",
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};
export const PRIORITY_ORDER: TicketPriority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];
export const PRIORITY_TONE: Record<TicketPriority, BadgeTone> = {
  URGENT: "danger-solid",
  HIGH: "warning",
  MEDIUM: "neutral",
  LOW: "outline",
};

export const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: "New",
  IN_PROGRESS: "In Progress",
  AWAITING_MERCHANT: "Awaiting Merchant",
  IN_REVIEW: "In Review",
  DONE: "Done",
};
export const STATUS_ORDER: TicketStatus[] = ["NEW", "IN_PROGRESS", "AWAITING_MERCHANT", "IN_REVIEW", "DONE"];
/** Status dot colours (design-system tokens). A dot always travels with its
 *  label — colour is never the only signal. */
export const STATUS_DOT: Record<TicketStatus, string> = {
  NEW: "bg-muted-foreground",
  IN_PROGRESS: "bg-primary",
  AWAITING_MERCHANT: "bg-warning",
  IN_REVIEW: "bg-data-issue",
  DONE: "bg-success",
};

export const REQUEST_TYPE_LABEL: Record<TicketRequestType, string> = {
  NEW_REQUEST: "New request",
  UPDATE: "Update to existing",
  QUERY: "Query",
  ISSUE: "Issue",
};

/** "2026-10-09" → "Oct 9" (this year) / "Oct 9, 2027". Parsed as a local
 *  date — `new Date("2026-10-09")` is UTC midnight and shows the day before
 *  in timezones west of UTC. */
export function formatDueDate(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Business seconds → "45m", "6h", "2d 4h" (a day = 24 business hours). */
export function formatDuration(seconds: number): string {
  const s = Math.abs(seconds);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  const d = Math.floor(s / 86400);
  const h = Math.round((s % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** Target hours → "2 hours", "1 working day", "5 working days". */
export function formatTarget(hours: number): string {
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return `${d} working day${d === 1 ? "" : "s"}${h ? ` ${h}h` : ""}`;
}
