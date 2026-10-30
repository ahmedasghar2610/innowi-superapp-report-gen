"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, CalendarRange, CircleDollarSign, Percent, Trophy } from "lucide-react";
import { Card, ErrorState, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useInsights } from "../../queries";
import type { HealthSlice, Insights, Leader, MonthPoint, OwnerQuery, StageBar } from "../../types";
import { AnimatedNumber, fmtCount, fmtMoney, fmtPercent } from "./animated-number";

const num = (s: string | number | null | undefined) => (s == null ? 0 : Number(s) || 0);
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const monthDate = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1);

/**
 * The animated overview at the top of My Day: headline numbers that count up,
 * deals won per month, the open pipeline by stage, restaurant health and, for
 * managers looking at everyone, a leaderboard. Same visibility as every Sales
 * screen — the API filters it (an Executive sees only their own numbers).
 */
export function SalesOverview({ query, showLeaderboard }: { query: OwnerQuery; showLeaderboard: boolean }) {
  const { data, isPending, isError, error, refetch } = useInsights(query);

  if (isError) {
    return (
      <Card>
        <ErrorState error={error} onRetry={() => refetch()} />
      </Card>
    );
  }
  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[118px]" />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-5">
          <Skeleton className="h-72 xl:col-span-3" />
          <Skeleton className="h-72 xl:col-span-2" />
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Sales overview" className="flex flex-col gap-4">
      <HeroStats data={data} />
      <div className="grid gap-4 xl:grid-cols-5">
        <WonByMonth points={data.wonByMonth} className="xl:col-span-3" />
        <PipelineByStage bars={data.pipelineByStage} withoutAmount={data.totals.dealsWithoutAmount} className="xl:col-span-2" />
      </div>
      <div className={cn("grid gap-4", showLeaderboard && data.leaderboard.length > 0 && "xl:grid-cols-2")}>
        <HealthMix slices={data.health} />
        {showLeaderboard && data.leaderboard.length > 0 && <Leaderboard leaders={data.leaderboard} />}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ headline --- */

function HeroStats({ data }: { data: Insights }) {
  const t = data.totals;
  const thisMonth = MONTH_YEAR.format(monthDate(data.wonByMonth[data.wonByMonth.length - 1]?.month ?? data.today.slice(0, 7)));
  const tiles = [
    {
      label: "Open pipeline",
      icon: Activity,
      value: num(t.openAmount),
      format: fmtMoney,
      foot: `${fmtCount(t.openDeals)} open deals`,
      emphasis: true,
    },
    {
      label: "Won this month",
      icon: Trophy,
      value: t.wonThisMonth,
      format: fmtCount,
      foot: `${fmtMoney(num(t.wonThisMonthAmount))} · ${thisMonth}`,
    },
    {
      label: "Won in the last 12 months",
      icon: CalendarRange,
      value: t.wonLast12Months,
      format: fmtCount,
      foot: `${fmtMoney(num(t.wonLast12MonthsAmount))} closed-won`,
    },
    {
      label: "Win rate",
      icon: Percent,
      value: t.winRate == null ? 0 : t.winRate * 100,
      format: t.winRate == null ? () => "—" : fmtPercent,
      foot:
        t.winRate == null
          ? "No deals closed in 12 months"
          : `${fmtCount(t.wonLast12Months)} won vs ${fmtCount(t.lostLast12Months)} lost · 12 months`,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile, i) => {
        const Icon = tile.icon;
        return (
          <div
            key={tile.label}
            className={cn(
              "sa-rise relative overflow-hidden rounded-[var(--radius-card)] border p-4",
              tile.emphasis ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card",
            )}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            {tile.emphasis && (
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-white/10"
              />
            )}
            <div className={cn("flex items-center gap-2 text-sm", tile.emphasis ? "text-primary-foreground/85" : "text-muted-foreground")}>
              <Icon className="size-4" aria-hidden />
              {tile.label}
            </div>
            <AnimatedNumber
              value={tile.value}
              format={tile.format}
              className="mt-2 block text-[32px] font-semibold leading-10 tracking-[-0.02em] tabular"
            />
            <p className={cn("mt-1 text-xs", tile.emphasis ? "text-primary-foreground/85" : "text-muted-foreground")}>
              {tile.foot}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------- won by month --- */

function WonByMonth({ points, className }: { points: MonthPoint[]; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.count));
  const best = points.reduce((b, p, i) => (p.count > points[b].count ? i : b), 0);
  const total = points.reduce((s, p) => s + p.count, 0);
  // Plot geometry (SVG units; the SVG scales to the card width).
  const W = 640;
  const H = 220;
  // Right padding holds the gridline values, clear of the bars and their labels.
  const pad = { top: 22, right: 30, bottom: 26, left: 8 };
  const plotH = H - pad.top - pad.bottom;
  const slot = (W - pad.left - pad.right) / points.length;
  const barW = Math.min(30, slot * 0.56);
  const ticks = [0.5, 1].map((f) => Math.round(max * f));

  return (
    <Card className={cn("sa-rise", className)} style={{ animationDelay: "120ms" }}>
      <div className="flex items-baseline justify-between gap-3 px-[18px] pt-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Deals won per month</h2>
          <p className="text-xs text-muted-foreground">Last 12 months, by close date · {fmtCount(total)} won</p>
        </div>
      </div>
      <div className="relative px-2 pb-3 pt-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Deals won per month, last 12 months">
          {/* recessive grid */}
          {ticks.map((v) => {
            const y = pad.top + plotH - (v / max) * plotH;
            return (
              <g key={v}>
                <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 4" />
                <text x={W - 4} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular">
                  {v}
                </text>
              </g>
            );
          })}
          <line x1={pad.left} x2={W - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} stroke="var(--border)" />
          {points.map((p, i) => {
            const h = Math.max(p.count > 0 ? 3 : 0, (p.count / max) * plotH);
            const x = pad.left + slot * i + (slot - barW) / 2;
            const y = pad.top + plotH - h;
            const label = i === best && p.count > 0 ? true : i === points.length - 1;
            return (
              <g key={p.month}>
                {/* hit target: the whole column, bigger than the bar */}
                <rect
                  x={pad.left + slot * i}
                  y={pad.top}
                  width={slot}
                  height={plotH}
                  fill={hover === i ? "var(--muted)" : "transparent"}
                  rx={6}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
                {h > 0 && (
                  <path
                    d={roundedTopBar(x, y, barW, h, 4)}
                    fill="var(--chart-1)"
                    opacity={hover == null || hover === i ? 1 : 0.45}
                    className="sa-grow-y pointer-events-none transition-opacity"
                    style={{ animationDelay: `${200 + i * 45}ms` }}
                  />
                )}
                {label && (
                  <text
                    x={x + barW / 2}
                    y={y - 6}
                    textAnchor="middle"
                    className="sa-rise pointer-events-none fill-foreground text-[12px] font-semibold tabular"
                    style={{ animationDelay: `${700 + i * 45}ms` }}
                  >
                    {p.count}
                  </text>
                )}
                <text
                  x={pad.left + slot * i + slot / 2}
                  y={H - 8}
                  textAnchor="middle"
                  className="pointer-events-none fill-muted-foreground text-[11px]"
                >
                  {MONTH.format(monthDate(p.month))}
                </text>
              </g>
            );
          })}
        </svg>
        {hover != null && (
          <div
            className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `${((pad.left + slot * hover + slot / 2) / W) * 100}%` }}
            role="status"
          >
            <div className="font-medium text-foreground">{MONTH_YEAR.format(monthDate(points[hover].month))}</div>
            <div className="text-muted-foreground">
              <span className="font-semibold text-foreground tabular">{points[hover].count}</span> won ·{" "}
              {fmtMoney(num(points[hover].amount))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/** A bar with 4px rounded top corners and a square base on the axis. */
function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/* ----------------------------------------------------- pipeline stages --- */

function PipelineByStage({ bars, withoutAmount, className }: { bars: StageBar[]; withoutAmount: number; className?: string }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  const total = bars.reduce((s, b) => s + b.count, 0);
  return (
    <Card className={cn("sa-rise", className)} style={{ animationDelay: "180ms" }}>
      <div className="px-[18px] pt-4">
        <h2 className="text-base font-semibold text-foreground">Open pipeline by stage</h2>
        <p className="text-xs text-muted-foreground">
          {fmtCount(total)} open deals (stale ones left out) · click a stage to see its deals
        </p>
      </div>
      <ul className="flex flex-col gap-1.5 px-3 pb-4 pt-3">
        {bars.map((b, i) => (
          <li key={b.key}>
            <Link
              href={`/sales/deals?${new URLSearchParams({ column: b.key, state: "open" }).toString()}`}
              className="group grid grid-cols-[minmax(0,9.5rem)_1fr_auto] items-center gap-3 rounded-md px-2 py-1 hover:bg-muted"
              title={`${b.label}: ${b.count} deals · ${fmtMoney(num(b.amount))}`}
            >
              <span className="truncate text-sm text-foreground">{b.label}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-muted group-hover:bg-card">
                <span
                  className="sa-grow-x block h-full rounded-full bg-[var(--chart-1)]"
                  style={{ width: `${(b.count / max) * 100}%`, animationDelay: `${260 + i * 60}ms` }}
                />
              </span>
              <span className="w-24 text-right text-sm tabular">
                <span className="font-semibold text-foreground">{b.count}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{fmtMoney(num(b.amount))}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {withoutAmount > 0 && (
        <p className="border-t border-border px-[18px] py-2 text-xs text-muted-foreground">
          {fmtCount(withoutAmount)} open deals have no amount in Salesforce, so dollar totals are lower than the real pipeline.
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- health --- */

/** Status colours carry meaning only alongside the label (never colour alone). */
const HEALTH_FILL: Record<string, string> = {
  Green: "var(--success)",
  Yellow: "#ca8a04",
  Orange: "#ea580c",
  Red: "var(--destructive)",
  "Newly Deployed": "var(--chart-1)",
};

function HealthMix({ slices }: { slices: HealthSlice[] }) {
  const total = slices.reduce((s, x) => s + x.count, 0);
  const max = Math.max(1, ...slices.map((s) => s.count));
  return (
    <Card className="sa-rise" style={{ animationDelay: "240ms" }}>
      <div className="px-[18px] pt-4">
        <h2 className="text-base font-semibold text-foreground">Restaurant health</h2>
        <p className="text-xs text-muted-foreground">
          {fmtCount(total)} restaurants, by their latest check-in (Touchpoint)
        </p>
      </div>
      {slices.length === 0 ? (
        <p className="px-[18px] pb-4 pt-3 text-sm text-muted-foreground">No restaurants yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 px-3 pb-4 pt-3">
          {slices.map((s, i) => {
            const fill = HEALTH_FILL[s.status] ?? "var(--chart-2)";
            const pct = total ? Math.round((s.count / total) * 100) : 0;
            return (
              <li
                key={s.status}
                className="grid grid-cols-[minmax(0,9.5rem)_1fr_auto] items-center gap-3 px-2 py-1"
                title={`${s.status}: ${s.count} restaurants (${pct}%)`}
              >
                <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: fill }} />
                  <span className="truncate">{s.status}</span>
                </span>
                <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="sa-grow-x block h-full rounded-full"
                    style={{ width: `${(s.count / max) * 100}%`, background: fill, animationDelay: `${320 + i * 60}ms` }}
                  />
                </span>
                <span className="w-24 text-right text-sm tabular">
                  <span className="font-semibold text-foreground">{s.count}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">{pct}%</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* -------------------------------------------------------- leaderboard --- */

function Leaderboard({ leaders }: { leaders: Leader[] }) {
  const max = Math.max(1, ...leaders.map((l) => l.wonCount));
  const ranked = useMemo(() => leaders, [leaders]);
  return (
    <Card className="sa-rise" style={{ animationDelay: "300ms" }}>
      <div className="px-[18px] pt-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <CircleDollarSign className="size-4 text-muted-foreground" aria-hidden />
          Leaderboard
        </h2>
        <p className="text-xs text-muted-foreground">Deals won in the last 90 days, then open deals</p>
      </div>
      <ol className="flex flex-col gap-1.5 px-3 pb-4 pt-3">
        {ranked.map((l, i) => (
          <li key={l.ownerId} className="grid grid-cols-[1.5rem_minmax(0,8rem)_1fr_auto] items-center gap-3 px-2 py-1">
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full text-xs font-semibold tabular",
                i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
              )}
            >
              {i + 1}
            </span>
            <span className="truncate text-sm text-foreground" title={l.name}>
              {l.name}
            </span>
            <span className="h-2.5 overflow-hidden rounded-full bg-muted">
              <span
                className="sa-grow-x block h-full rounded-full bg-[var(--chart-1)]"
                style={{ width: `${(l.wonCount / max) * 100}%`, animationDelay: `${380 + i * 60}ms` }}
              />
            </span>
            <span className="w-28 text-right text-sm tabular" title={`${l.wonCount} won (${fmtMoney(num(l.wonAmount))}) · ${l.openDeals} open`}>
              <span className="font-semibold text-foreground">{l.wonCount}</span>
              <span className="ml-1 text-xs text-muted-foreground">won · {l.openDeals} open</span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
