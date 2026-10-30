"use client";

import { useSyncExternalStore } from "react";

/**
 * Command Center period — "Last N days vs previous period" in the top bar.
 * One shared value for Home, Issues, Reports and the sidebar count,
 * remembered per browser.
 */
export const RANGE_OPTIONS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_OPTIONS)[number];

const KEY = "innowi.commandCenter.days";
const DEFAULT: RangeDays = 30;
let current: RangeDays = DEFAULT;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const v = Number(window.localStorage.getItem(KEY));
    if ((RANGE_OPTIONS as readonly number[]).includes(v)) current = v as RangeDays;
  } catch {
    /* storage unavailable */
  }
}

export function setRangeDays(days: RangeDays) {
  current = days;
  try {
    window.localStorage.setItem(KEY, String(days));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useRangeDays(): RangeDays {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => {
      load();
      return current;
    },
    () => DEFAULT,
  );
}

/* ---------------------------------------------------------------- dates -- */

/** "YYYY-MM-DD" ± days, in UTC so time zones never shift the day. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface Window {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
}

/** The last `days` days ending on `end`, plus the same-length period before. */
export function windowEnding(end: string, days: number): Window {
  const start = addDays(end, -(days - 1));
  return { start, end, prevEnd: addDays(start, -1), prevStart: addDays(start, -days) };
}

export function shortDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Whole days between an ISO date and today. */
export function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.floor((Date.now() - then) / 86_400_000);
}
