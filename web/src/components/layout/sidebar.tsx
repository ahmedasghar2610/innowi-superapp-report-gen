"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Settings } from "lucide-react";
import { NAV_GROUPS, NAV_BOTTOM, NAV_FOOTER, type NavGroup, type NavLink, type NavBadgeKey } from "@/config/nav";
import { APP_NAME } from "@/lib/constants";
import { BrandMark } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils/cn";
import { useCan } from "@/features/auth/use-can";
import { useAuth } from "@/features/auth/auth-context";
import { ROLE_LABELS, userDisplayName, userInitials } from "@/features/auth/types";
import { useTicketCounts } from "@/features/tickets/api";
import { useCommandCenter } from "@/features/home/live/use-command-center";

const COLLAPSED_KEY = "innowi.sidebar.collapsed";

function useActive() {
  const pathname = usePathname();
  const match = (href: string, exact = false) =>
    href === "/" || exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  return (entry: NavLink) => match(entry.href, entry.exact) || (entry.activeAlso ?? []).some((h) => match(h));
}

/** Live counts for the nav pills. Each pill is its own component, so a count
 *  is only fetched when its nav entry is visible to this person. Ticket counts
 *  refresh every minute. */
const BADGE_OPTS = { refetchInterval: 60_000, staleTime: 30_000 } as const;

function TicketsOpenCount({ render }: { render: (n: number | undefined) => React.ReactNode }) {
  return <>{render(useTicketCounts({ view: "open" }, BADGE_OPTS).data?.total)}</>;
}
function TicketsMineCount({ render }: { render: (n: number | undefined) => React.ReactNode }) {
  return <>{render(useTicketCounts({ view: "open", assigneeId: "me" }, BADGE_OPTS).data?.total)}</>;
}
/** Same live rules as Command Center "Needs Attention" (GBP, Ads, tickets,
 *  profiles); the reads are shared with that page through the query cache.
 *  Counts only critical + high items, so it stays meaningful. */
function IssuesCount({ render }: { render: (n: number | undefined) => React.ReactNode }) {
  // This pill needs every Command Center source (up to ~10 API calls), so it
  // waits until the page's own requests have had a head start. The sidebar
  // stays mounted across pages, so the wait only happens on the first load.
  const ready = useAfterFirstPaint(ISSUES_DELAY_MS);
  return ready ? <IssuesCountLoaded render={render} /> : <>{render(undefined)}</>;
}
function IssuesCountLoaded({ render }: { render: (n: number | undefined) => React.ReactNode }) {
  const cc = useCommandCenter();
  return <>{render(cc.loading ? undefined : cc.issues.filter((i) => i.severity === "critical" || i.severity === "high").length)}</>;
}
const ISSUES_DELAY_MS = 2500;
/** False until `ms` after mount, then true (and stays true). */
function useAfterFirstPaint(ms: number): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), ms);
    return () => window.clearTimeout(id);
  }, [ms]);
  return ready;
}
const BADGE_SOURCES: Record<NavBadgeKey, typeof IssuesCount> = {
  issues: IssuesCount,
  "tickets-open": TicketsOpenCount,
  "tickets-mine": TicketsMineCount,
};

/** Collapsed group keys, remembered per browser. Starts empty on the server
 *  and on first paint, then reads storage, so there's no hydration mismatch. */
function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_KEY);
      if (raw) setCollapsed(JSON.parse(raw));
    } catch {
      /* storage unavailable — everything stays open */
    }
  }, []);
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  return { collapsed, toggle };
}

/**
 * Left navigation — Figma "Sidebar" (Super App - Marketing Ops · node 23:1171),
 * with the Ops CRM and Marketing groups from the 8 Oct 2026 sidebar proposal.
 *
 *   shell        240px · bg --sidebar · border-r --sidebar-border
 *   header       32px brand tile · "Innowi" 14/20 medium · "Super App" 12/16
 *   group label  h-8 · px-2 · 12/16 medium · 70% opacity (+ chevron when collapsible)
 *   menu button  h-8 · p-2 · gap-2 · radius-md · 16px icon · 14/20 regular
 *   active       bg --sidebar-accent · text --sidebar-accent-foreground
 *   count pill   primary · 11/16 semibold · hidden at 0
 *   bottom       pinned links (none since 16 Oct 2026 — moved into Admin)
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const isActive = useActive();
  const can = useCan();
  const { user } = useAuth();
  const { collapsed, toggle } = useCollapsedGroups();
  const visible = (entry: { capability?: NavLink["capability"] }) => !entry.capability || can(entry.capability);
  const bottomLinks = NAV_BOTTOM.filter(visible);

  const renderItem = (entry: NavLink) => {
    const Icon = entry.icon;
    const active = isActive(entry);
    const Count = entry.badge ? BADGE_SOURCES[entry.badge] : null;
    return (
      <Link
        key={entry.key}
        href={entry.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md p-2 text-sm font-normal transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground [&_svg]:text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-hover [&_svg]:text-sidebar-muted-foreground hover:[&_svg]:text-sidebar-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {entry.tag && (
          <span className="rounded-[4px] bg-muted px-1.5 text-[10px] font-medium leading-4 text-muted-foreground">{entry.tag}</span>
        )}
        {Count ? (
          <Count
            render={(count) =>
              count ? (
                <span
                  className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold leading-4 tabular-nums text-primary-foreground"
                  aria-label={`${count} open`}
                  title={entry.badge === "issues" ? "Critical and high issues" : undefined}
                >
                  {count > 99 ? "99+" : count}
                </span>
              ) : null
            }
          />
        ) : null}
      </Link>
    );
  };

  const renderGroup = (group: NavGroup) => {
    if (group.capability && !can(group.capability)) return null;
    const items = group.items.filter(visible);
    if (items.length === 0) return null;
    // A collapsed group re-opens while you're on one of its pages.
    const holdsActive = items.some(isActive);
    const open = !group.collapsible || holdsActive || !collapsed.includes(group.key);
    const listId = `nav-group-${group.key}`;
    return (
      <div key={group.key} className="flex flex-col gap-0.5 px-2 pt-3">
        {group.collapsible ? (
          <button
            type="button"
            onClick={() => toggle(group.key)}
            aria-expanded={open}
            aria-controls={listId}
            disabled={holdsActive}
            className="flex h-8 items-center justify-between rounded-md px-2 text-xs font-medium leading-4 text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground enabled:hover:bg-sidebar-hover disabled:cursor-default"
          >
            {group.label}
            <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} aria-hidden />
          </button>
        ) : (
          <div className="flex h-8 items-center px-2 text-xs font-medium leading-4 opacity-70">{group.label}</div>
        )}
        {open && (
          <div id={listId} className="flex flex-col gap-0.5">
            {items.map(renderItem)}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      className="flex h-full w-60 flex-col bg-sidebar text-sidebar-foreground"
      aria-label="Main navigation"
    >
      {/* header: brand + product name */}
      <div className="px-2 pb-1 pt-2">
        <Link href="/" onClick={onNavigate} className="flex w-full items-center gap-2 rounded-md p-2 hover:bg-sidebar-hover" title={`${APP_NAME} · Marketing Ops`}>
          <BrandMark />
          <span className="min-w-0 flex-1">
            {/* Innowi wordmark from innowi.com (dark ink); inverted to light ink in dark mode. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny static asset, no optimisation needed */}
            <img
              src="/brand/innowi-wordmark.png"
              alt={APP_NAME}
              width={198}
              height={51}
              className="block h-[17px] w-auto dark:invert"
            />
            <span className="mt-0.5 block truncate text-xs leading-4">Marketing Ops</span>
          </span>
        </Link>
      </div>

      {/* groups */}
      <nav className="flex-1 overflow-y-auto pb-3">{NAV_GROUPS.map(renderGroup)}</nav>

      {/* pinned setup links */}
      {bottomLinks.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-sidebar-border p-2">{bottomLinks.map(renderItem)}</div>
      )}

      {/* account (Figma "Account", node 23:1370) */}
      <div className="flex items-center gap-2.5 border-t border-sidebar-border p-3">
        {user ? (
          <>
            <span
              className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
              aria-hidden
            >
              {userInitials(user)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-5 text-sidebar-foreground">{userDisplayName(user)}</span>
              <span className="block truncate text-xs leading-4 text-muted-foreground">{ROLE_LABELS[user.role]}</span>
            </span>
          </>
        ) : (
          <>
            <span className="size-6 animate-pulse rounded-full bg-accent" aria-hidden />
            <span className="h-4 flex-1 animate-pulse rounded bg-muted" aria-hidden />
          </>
        )}
        <Link
          href={NAV_FOOTER.href}
          onClick={onNavigate}
          aria-label={NAV_FOOTER.label}
          title={NAV_FOOTER.label}
          aria-current={isActive(NAV_FOOTER) ? "page" : undefined}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-sidebar-hover",
            isActive(NAV_FOOTER) ? "text-sidebar-accent-foreground" : "text-sidebar-muted-foreground hover:text-sidebar-foreground",
          )}
        >
          <Settings className="size-4" aria-hidden />
        </Link>
      </div>
    </aside>
  );
}
