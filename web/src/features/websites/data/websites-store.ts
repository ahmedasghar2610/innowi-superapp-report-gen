"use client";

import { useSyncExternalStore } from "react";
import type { Website, WebsiteStatus, WebsiteValues } from "../types";
import { summarise } from "../lib/website-values";

/**
 * Local stand-in for the (not yet built) websites API.
 *
 * Records live in `localStorage` and are shared across every component through
 * a tiny observable store, so the list, the drawer and the delete dialog all
 * see the same data without prop drilling. When `GET/POST /websites` lands,
 * replace the four mutators below with TanStack Query hooks — nothing outside
 * this file knows where the data comes from.
 */

const STORAGE_KEY = "innowi:websites:v1";
const DRAFT_KEY = "innowi:websites:draft:v1";

let websites: Website[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

function read(): Website[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Website[]) : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(websites));
  } catch {
    /* private mode / quota — the in-memory list still works for this session */
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  // First subscriber hydrates from storage; doing it here (rather than at
  // module scope) keeps the server snapshot empty and avoids a hydration
  // mismatch on first paint.
  if (!hydrated) {
    hydrated = true;
    websites = read();
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: Website[] = [];
const getSnapshot = () => (hydrated ? websites : EMPTY);
const getServerSnapshot = () => EMPTY;

function commit(next: Website[]) {
  websites = next;
  persist();
  emit();
}

/** URL-safe key derived from the business name; suffixed to stay unique in the local list. */
function newSlug(name: string, taken: Website[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "website";
  let slug = base;
  for (let i = 2; taken.some((w) => w.slug === slug); i++) slug = `${base}-${i}`;
  return slug;
}

function newId(): string {
  return `web_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/* -------------------------------------------------------------- mutations */

export function createWebsite(values: WebsiteValues, status: WebsiteStatus = "in_creation"): Website {
  const now = new Date().toISOString();
  const summary = summarise(values);
  const record: Website = {
    id: newId(),
    ...summary,
    slug: newSlug(summary.name, websites),
    notes: "",
    status,
    createdAt: now,
    updatedAt: now,
    values,
  };
  commit([record, ...websites]);
  return record;
}

export function updateWebsite(id: string, values: WebsiteValues, status?: WebsiteStatus): void {
  commit(
    websites.map((w) =>
      w.id === id
        ? { ...w, ...summarise(values), status: status ?? w.status, values, updatedAt: new Date().toISOString() }
        : w,
    ),
  );
}

export function setWebsiteStatus(id: string, status: WebsiteStatus): void {
  commit(websites.map((w) => (w.id === id ? { ...w, status, updatedAt: new Date().toISOString() } : w)));
}

export function deleteWebsite(id: string): void {
  commit(websites.filter((w) => w.id !== id));
}

/* ------------------------------------------------------------------ hooks */

/** The websites list, newest activity first. Empty during SSR. */
export function useWebsites(): Website[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/* ------------------------------------------------------ in-progress draft */

/**
 * The unsaved answers of a new website, so closing the drawer mid-way doesn't
 * lose the work. Cleared once the record is created.
 */
export function readDraft(): WebsiteValues | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as WebsiteValues) : null;
  } catch {
    return null;
  }
}

export function writeDraft(values: WebsiteValues): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
  } catch {
    /* ignore */
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
