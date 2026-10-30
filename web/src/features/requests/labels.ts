import type { BadgeTone } from "@/components/ui";
import type { RequestArea, RequestStatus, RequestType, Urgency } from "./types";

export const TYPES: RequestType[] = ["FEATURE", "IMPROVEMENT", "BUG", "COMPLAINT", "DATA", "PROCESS"];
export const TYPE_LABEL: Record<RequestType, string> = {
  FEATURE: "New feature",
  IMPROVEMENT: "Improvement",
  BUG: "Bug",
  COMPLAINT: "Complaint",
  DATA: "Data",
  PROCESS: "Process",
};
export const TYPE_HINT: Record<RequestType, string> = {
  FEATURE: "A new screen, field, report or automation",
  IMPROVEMENT: "Make something that already exists work better",
  BUG: "Something is broken or shows the wrong thing",
  COMPLAINT: "Something is getting in the way of your work",
  DATA: "Import, clean up or fix data (e.g. a spreadsheet to bring in)",
  PROCESS: "A workflow the app should follow (who does what, in what order)",
};

export const AREAS: RequestArea[] = [
  "SALES",
  "PARTNERS",
  "SUPPORT",
  "OPERATIONS",
  "MARKETING",
  "PAYMENTS",
  "REPORTING",
  "PLATFORM",
  "OTHER",
];
export const AREA_LABEL: Record<RequestArea, string> = {
  SALES: "Sales",
  PARTNERS: "Partners / ISOs",
  SUPPORT: "Support",
  OPERATIONS: "Operations",
  MARKETING: "Marketing",
  PAYMENTS: "Payments & billing",
  REPORTING: "Reporting",
  PLATFORM: "The app itself",
  OTHER: "Other",
};

export const URGENCIES: Urgency[] = ["LOW", "NORMAL", "HIGH", "BLOCKING"];
export const URGENCY_LABEL: Record<Urgency, string> = {
  LOW: "Low — nice to have",
  NORMAL: "Normal",
  HIGH: "High — slows me down every day",
  BLOCKING: "Blocking — I can't do my job",
};
export const URGENCY_SHORT: Record<Urgency, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", BLOCKING: "Blocking" };

export const STATUS_LABEL: Record<RequestStatus, string> = {
  NEW: "New",
  UNDER_REVIEW: "Under review",
  NEEDS_INFO: "Needs info",
  APPROVED: "On the roadmap",
  IN_PROGRESS: "In progress",
  SHIPPED: "Shipped",
  DECLINED: "Declined",
  DUPLICATE: "Duplicate",
};
export const STATUS_TONE: Record<RequestStatus, BadgeTone> = {
  NEW: "accent",
  UNDER_REVIEW: "neutral",
  NEEDS_INFO: "warning",
  APPROVED: "primary",
  IN_PROGRESS: "primary",
  SHIPPED: "success",
  DECLINED: "danger",
  DUPLICATE: "outline",
};

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Split the links box into lines; show http(s) ones as links. */
export function linkLines(text: string | null): { text: string; href?: string }[] {
  return (text ?? "")
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (/^https?:\/\/\S+$/i.test(t) ? { text: t, href: t } : { text: t }));
}
