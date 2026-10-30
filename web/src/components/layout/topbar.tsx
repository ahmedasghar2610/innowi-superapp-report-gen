"use client";

import { usePathname } from "next/navigation";
import { Menu, Search, Store, CalendarDays, ChevronDown } from "lucide-react";
import { NotificationBell } from "./notification-bell";
import { Breadcrumbs } from "./breadcrumbs";
import { ThemeToggle } from "./theme-toggle";
import { AccountMenu } from "./account-menu";
import Link from "next/link";
import { useMerchants } from "@/features/merchants/api/merchants.queries";
import { RANGE_OPTIONS, setRangeDays, useRangeDays, type RangeDays } from "@/features/home/live/range";

/**
 * Top bar — Figma "Top bar" (Super-Admin-App · node 24:1404): h-16 · px-6 ·
 * gap-3 · border-b. Left: the portfolio scope and date-range selectors on the
 * Command Center; on every other screen the breadcrumb trail takes that slot.
 * Right: search · bell · account avatar (28px icon buttons, 24px avatar).
 * `onOpenNav` opens the sidebar on mobile.
 */
export function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const pathname = usePathname();
  // The portfolio selectors sit on the Command Center pages that use them.
  const isHome = pathname === "/command-center" || pathname === "/issues" || pathname === "/reports";

  return (
    <header className="flex h-16 flex-shrink-0 items-center gap-3 border-b border-border bg-background px-6">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="grid size-7 place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground lg:hidden"
      >
        <Menu className="size-4" />
      </button>

      {isHome ? (
        <>
          <MerchantScope />
          <RangeSelector />
        </>
      ) : (
        <Breadcrumbs />
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Search"
          className="grid size-7 place-items-center rounded-sm text-foreground hover:bg-secondary"
        >
          <Search className="size-4" />
        </button>
        <NotificationBell />
        <ThemeToggle />
        <AccountMenu />
      </div>
    </header>
  );
}

const selectorCls =
  "relative inline-flex h-7 items-center gap-1 whitespace-pre rounded-sm border border-border bg-background px-2.5 text-xs font-medium leading-4 text-foreground hover:bg-secondary";

/** Figma "Selector · My accounts · N merchants" — live merchant count, opens the list. */
function MerchantScope() {
  const q = useMerchants({ limit: 1 }, { staleTime: 5 * 60_000 });
  const total = q.data?.meta.total;
  return (
    <Link href="/merchants" className={selectorCls} title="Open the merchant list">
      <Store className="size-4 text-muted-foreground" />
      {`All merchants  ·  ${total == null ? "…" : total.toLocaleString("en-US")}`}
      <ChevronDown className="size-4 -rotate-90 text-muted-foreground" />
    </Link>
  );
}

/** Figma "Selector · Last 30 days vs previous period" — a real 7 / 30 / 90-day switch. */
function RangeSelector() {
  const days = useRangeDays();
  return (
    <label className={`${selectorCls} hidden cursor-pointer sm:inline-flex`}>
      <CalendarDays className="size-4 text-muted-foreground" />
      {`Last ${days} days  vs  previous period`}
      <ChevronDown className="size-4 text-muted-foreground" />
      <select
        aria-label="Period"
        value={days}
        onChange={(e) => setRangeDays(Number(e.target.value) as RangeDays)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {RANGE_OPTIONS.map((d) => (
          <option key={d} value={d}>
            Last {d} days vs previous {d}
          </option>
        ))}
      </select>
    </label>
  );
}
