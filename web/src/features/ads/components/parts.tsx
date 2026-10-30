"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Info, TriangleAlert } from "lucide-react";
import { Badge, Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import {
  ALERT_TONE,
  PERIOD_PRESETS,
  RESTAURANT_STATUS,
  ROAS,
  SYNC,
  VERIFICATION,
  fmtRoas,
  localToday,
  periodFromParams,
  periodLabel,
  periodToParams,
  resolvePeriod,
  change,
  changeText,
  changeTone,
  fmtRange,
  type Better,
  type PeriodState,
} from "../lib";
import type { Alert, Period, PeriodQuery, RestaurantStatus, RoasStatus, SyncState, Verification } from "../types";

export { NoData, Section } from "@/features/gbp/components/parts";

/** Period kept in the URL (?period=report | this-month | … | day&start | custom&start&end),
 *  shared by the portfolio and a restaurant page so a link reproduces the view. */
export function usePeriodParam() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = periodFromParams(new URLSearchParams(params.toString()));
  // "vs previous period" is on unless the URL says ?compare=off.
  const compare = params.get("compare") !== "off";
  const dates: PeriodQuery = { ...resolvePeriod(state), ...(compare ? { compare: "previous" as const } : {}) };
  const set = (next: PeriodState, extra: Record<string, string | undefined> = {}) => {
    const p = new URLSearchParams(params.toString());
    ["period", "start", "end"].forEach((k) => p.delete(k));
    Object.entries({ ...periodToParams(next), ...extra }).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const setCompare = (on: boolean) => {
    const p = new URLSearchParams(params.toString());
    if (on) p.delete("compare");
    else p.set("compare", "off");
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const qs = new URLSearchParams({ ...periodToParams(state), ...(compare ? {} : { compare: "off" }) }).toString();
  return { state, dates, set, qs, query: params, compare, setCompare };
}

/** "Compare: Previous period / Off" next to the period picker. */
export function CompareToggle({ on, onChange, period }: { on: boolean; onChange: (on: boolean) => void; period?: Period | null }) {
  return (
    <div
      className="flex items-center rounded-lg border border-border bg-card p-0.5 print:hidden"
      role="group"
      aria-label="Compare with"
      title={on && period ? `Compared with ${fmtRange(period.start, period.end)}` : "Show the change against the previous period"}
    >
      <span className="px-2 text-xs text-muted-foreground">Compare</span>
      {(
        [
          [true, "Previous period"],
          [false, "Off"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={label}
          type="button"
          aria-pressed={on === v}
          onClick={() => onChange(v)}
          className={cn(
            "h-7 rounded-md px-2.5 text-xs font-medium whitespace-nowrap",
            on === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** "▲ 12% vs Sep 1 – Sep 30" under a number. Green/red only when the direction is good/bad news (`better`). */
export function Delta({
  cur,
  prev,
  better = "up",
  suffix = "",
  points = false,
  title,
  className,
}: {
  cur: number | null | undefined;
  prev: number | null | undefined;
  better?: Better;
  suffix?: string;
  /** Show the difference in percentage points (for ROI, itself a %). */
  points?: boolean;
  title?: string;
  className?: string;
}) {
  if (points) {
    const diff = cur == null || prev == null ? null : Math.round(cur - prev);
    const tone = diff == null || diff === 0 || better === "none" ? "none" : (diff > 0) === (better === "up") ? "good" : "bad";
    return (
      <span
        title={title}
        className={cn(
          "text-xs tabular-nums whitespace-nowrap",
          tone === "good" ? "text-success-subtle-foreground" : tone === "bad" ? "text-text-destructive" : "text-muted-foreground",
          className,
        )}
      >
        {diff == null ? "No earlier data" : diff === 0 ? `No change${suffix}` : `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff).toLocaleString("en-US")} pts${suffix}`}
      </span>
    );
  }
  const c = change(cur, prev);
  const tone = changeTone(c, better);
  return (
    <span
      title={title}
      className={cn(
        "text-xs tabular-nums whitespace-nowrap",
        tone === "good" ? "text-success-subtle-foreground" : tone === "bad" ? "text-text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {changeText(c, suffix)}
    </span>
  );
}

/** "July 2026 (report period) ▾" — presets, a single day, or a custom range.
 *  Budget figures are always a calendar month and don't follow this. */
export function PeriodPicker({ state, onChange }: { state: PeriodState; onChange: (p: PeriodState) => void }) {
  const [open, setOpen] = useState(false);
  const today = localToday();
  const r = resolvePeriod(state, today);
  const [dayVal, setDayVal] = useState(state.key === "day" ? (state.start ?? "") : "");
  const [start, setStart] = useState(r.start ?? "");
  const [end, setEnd] = useState(r.end ?? "");
  useEffect(() => {
    setStart(r.start ?? "");
    setEnd(r.end ?? "");
  }, [r.start, r.end]);

  return (
    <div className="relative print:hidden">
      <Button variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog">
        <CalendarDays className="size-4" />
        {periodLabel(state, today)}
      </Button>
      {open && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label="Performance period" className="absolute right-0 z-40 mt-1.5 flex w-80 flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-xl">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Performance period</div>
              <div className="grid grid-cols-2 gap-1">
                {PERIOD_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      onChange({ key: p.key });
                      setOpen(false);
                    }}
                    className={cn(
                      "h-8 rounded-md px-2 text-left text-xs font-medium",
                      state.key === p.key ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <form
              className="flex items-end gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (dayVal) {
                  onChange({ key: "day", start: dayVal });
                  setOpen(false);
                }
              }}
            >
              <label className="flex flex-1 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Single day
                <Input type="date" value={dayVal} max={today} onChange={(e) => setDayVal(e.target.value)} className="h-8" />
              </label>
              <Button type="submit" size="sm" variant="outline" disabled={!dayVal}>
                Apply
              </Button>
            </form>
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (start && end) {
                  onChange({ key: "custom", start, end });
                  setOpen(false);
                }
              }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Custom range</div>
              <div className="flex items-center gap-1.5">
                <Input type="date" value={start} max={end || today} onChange={(e) => setStart(e.target.value)} className="h-8" aria-label="From" />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} className="h-8" aria-label="To" />
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={!start || !end}>
                Apply range
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">Budget figures always describe a calendar month and are shown separately from this performance period.</p>
          </div>
        </>
      )}
    </div>
  );
}

export function RestaurantStatusBadge({ status }: { status: RestaurantStatus }) {
  const s = RESTAURANT_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function VerificationBadge({ v }: { v: Verification }) {
  const s = VERIFICATION[v];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function SyncBadge({ s }: { s: SyncState }) {
  const x = SYNC[s];
  return <Badge tone={x.tone}>{x.label}</Badge>;
}

/** First alert as a chip, the rest as "+N" (detail in the tooltip). "—" when none. */
export function AlertBadges({ alerts, all = false }: { alerts: Alert[]; all?: boolean }) {
  if (!alerts.length) return <span className="text-muted-foreground">—</span>;
  const shown = all ? alerts : alerts.slice(0, 1);
  const rest = alerts.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title={alerts.map((a) => `${a.label}: ${a.detail}`).join("\n")}>
      {shown.map((a) => (
        <Badge key={a.type} tone={ALERT_TONE[a.type]} icon={TriangleAlert}>
          {a.label}
        </Badge>
      ))}
      {rest > 0 && <Badge tone="neutral">+{rest}</Badge>}
    </span>
  );
}

export function RoasValue({ roas, status }: { roas: number | null; status: RoasStatus }) {
  return (
    <span className={cn("font-medium tabular-nums", ROAS[status.key].text)} title={status.label}>
      {fmtRoas(roas)}
    </span>
  );
}

export function RoasChip({ status }: { status: RoasStatus }) {
  if (status.key === "na") return <span className="text-xs text-muted-foreground">N/A</span>;
  return (
    <Badge tone={ROAS[status.key].tone} icon={false}>
      {status.label}
    </Badge>
  );
}

/** A table header with the prototype's ⓘ explanation. */
export function HeadHint({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={hint}>
      {label}
      {hint && <Info className="size-3.5 text-muted-foreground" aria-label={hint} />}
    </span>
  );
}

export function DemoBadge() {
  return (
    <Badge tone="dataq" title="Sample data — replaced by the first real Google Ads sync">
      Sample data
    </Badge>
  );
}

/** Label + value + explanation, used in the budget panel and the header grid. */
export function Fact({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" title={hint}>
        {label}
        {hint && <Info className="size-3.5" aria-label={hint} />}
      </span>
      <span className="min-w-0 text-sm font-medium text-foreground">{children}</span>
    </div>
  );
}
