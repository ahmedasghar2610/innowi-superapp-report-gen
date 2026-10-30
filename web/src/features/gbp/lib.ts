import type { BadgeTone } from "@/components/ui";
import type { Change, OpenStatus, SyncState, Verification } from "./types";

/* ----------------------------------------------------------- numbers ---- */
export const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

export function changeText(c: Change | undefined, suffix = " vs previous period"): string {
  if (!c || c.kind === "na") return "No earlier data";
  if (c.kind === "flat") return "No activity either period";
  if (c.kind === "new") return "New activity";
  if (c.value === 0) return `No change${suffix}`;
  return `${c.value > 0 ? "▲" : "▼"} ${Math.abs(c.value)}%${suffix}`;
}

export function changeTone(c: Change | undefined): "up" | "down" | "none" {
  if (!c) return "none";
  if (c.kind === "new") return "up";
  if (c.kind !== "pct" || c.value === 0) return "none";
  return c.value > 0 ? "up" : "down";
}

/* ------------------------------------------------------------- dates ---- */
// Dates from the API are calendar days (YYYY-MM-DD); format them in UTC so
// the viewer's timezone never shifts a day.
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const isoOf = (dt: Date) => dt.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => isoOf(new Date(d(iso).getTime() + n * 86400000));
export const fmtDay = (iso: string | null | undefined, year = true) =>
  iso ? d(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }) : "—";
export const fmtMonth = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
export const fmtRange = (start: string, end: string) => {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${fmtDay(start, !sameYear)} – ${fmtDay(end)}`;
};
export function fmtAgo(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return "never";
  const mins = Math.round((Date.now() - new Date(isoDateTime).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** A time of day in the viewer's own clock ("6:00 AM"). */
export const autoTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/* ------------------------------------------------------------ ranges ---- */
export type PresetKey = "7d" | "30d" | "90d" | "this-month" | "last-month" | "custom";
export const PRESETS: { key: Exclude<PresetKey, "custom">; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
];

export interface RangeState {
  preset: PresetKey;
  start?: string;
  end?: string;
}

/** Concrete dates for a preset. Presets end on the latest day Google has
 *  published ("data through"), not today — Google runs 2–5 days behind. */
export function resolvePreset(r: RangeState, through: string | null): { start?: string; end?: string } {
  if (r.preset === "custom") return { start: r.start, end: r.end };
  if (!through) return {};
  switch (r.preset) {
    case "7d":
      return { start: addDays(through, -6), end: through };
    case "30d":
      return { start: addDays(through, -29), end: through };
    case "90d":
      return { start: addDays(through, -89), end: through };
    case "this-month":
      return { start: `${through.slice(0, 7)}-01`, end: through };
    case "last-month": {
      const firstThis = `${through.slice(0, 7)}-01`;
      const lastPrev = addDays(firstThis, -1);
      return { start: `${lastPrev.slice(0, 7)}-01`, end: lastPrev };
    }
  }
}

export function rangeFromParams(p: URLSearchParams): RangeState {
  const preset = (p.get("range") as PresetKey) || "30d";
  if (preset === "custom") return { preset, start: p.get("start") ?? undefined, end: p.get("end") ?? undefined };
  return { preset: PRESETS.some((x) => x.key === preset) ? preset : "30d" };
}

export function rangeToParams(r: RangeState): Record<string, string> {
  return r.preset === "custom" && r.start && r.end ? { range: "custom", start: r.start, end: r.end } : { range: r.preset };
}

/* ------------------------------------------------------------ labels ---- */
export const OPEN_STATUS: Record<OpenStatus, { label: string; tone: BadgeTone }> = {
  OPEN: { label: "Open", tone: "success" },
  UNKNOWN: { label: "Open", tone: "success" },
  CLOSED_TEMPORARILY: { label: "Temporarily closed", tone: "warning" },
  CLOSED_PERMANENTLY: { label: "Permanently closed", tone: "neutral" },
};

export const VERIFICATION: Record<Verification, { label: string; tone: BadgeTone }> = {
  verified: { label: "Verified", tone: "accent" },
  pending: { label: "Verification pending", tone: "neutral" },
  required: { label: "Verification required", tone: "danger" },
  unknown: { label: "Verification unknown", tone: "neutral" },
};

export const SYNC_STATE: Record<SyncState, { label: string; tone: BadgeTone } | null> = {
  ok: null,
  delayed: { label: "Data delayed", tone: "warning" },
  failed: { label: "Sync failed", tone: "danger" },
};

/* ------------------------------------------------------------ export ---- */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((c) => {
          const s = c == null ? "" : String(c);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
