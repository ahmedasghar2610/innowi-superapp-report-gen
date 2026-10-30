import type { BadgeTone } from "@/components/ui";
import type { Area, ItemStatus, Phase, Priority } from "./types";

export const AREA_LABEL: Record<Area, string> = {
  SALES: "Sales",
  MERCHANTS: "Merchants",
  MARKETING: "Marketing",
  PLATFORM: "Platform & security",
};
export const AREAS: Area[] = ["SALES", "MERCHANTS", "MARKETING", "PLATFORM"];

export const STATUS_LABEL: Record<ItemStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};
export const STATUSES: ItemStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"];
export const STATUS_TONE: Record<ItemStatus, BadgeTone> = {
  TODO: "neutral",
  IN_PROGRESS: "accent",
  BLOCKED: "danger",
  DONE: "success",
};

export const PRIORITY_LABEL: Record<Priority, string> = { HIGH: "High", NORMAL: "Normal", LOW: "Low" };

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const MONTH_ONLY = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const d = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** "Nov 2026", or "Dec 2026 – Jan 2027", or "Feb – Mar 2027". */
export function monthRange(start: string, end: string): string {
  if (start.slice(0, 7) === end.slice(0, 7)) return MONTH.format(d(start));
  if (start.slice(0, 4) === end.slice(0, 4)) return `${MONTH_ONLY.format(d(start))} – ${MONTH.format(d(end))}`;
  return `${MONTH.format(d(start))} – ${MONTH.format(d(end))}`;
}

export function shortDate(iso?: string | null): string {
  return iso ? DAY.format(d(iso)) : "";
}

/** Today's date as yyyy-mm-dd (local). */
export function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export type PhaseState = "done" | "now" | "next" | "later" | "late";

/** Where a phase stands today: finished, current, the next one, further out, or past its months with work left. */
export function phaseState(p: Phase, phases: Phase[], today = todayIso()): PhaseState {
  const month = today.slice(0, 7);
  const allDone = p.counts.total > 0 && p.counts.done === p.counts.total;
  if (allDone) return "done";
  if (p.endMonth.slice(0, 7) < month) return "late";
  if (p.startMonth.slice(0, 7) <= month) return "now";
  const upcoming = phases.filter((x) => x.startMonth.slice(0, 7) > month).sort((a, b) => a.startMonth.localeCompare(b.startMonth));
  return upcoming[0]?.id === p.id ? "next" : "later";
}

export const PHASE_STATE_LABEL: Record<PhaseState, string> = {
  done: "Done",
  now: "Now",
  next: "Next",
  later: "Later",
  late: "Past its months",
};
export const PHASE_STATE_TONE: Record<PhaseState, BadgeTone> = {
  done: "success",
  now: "primary",
  next: "accent",
  later: "neutral",
  late: "warning",
};

export function isOverdue(target?: string | null, status?: ItemStatus, today = todayIso()): boolean {
  return Boolean(target && status !== "DONE" && target < today);
}
