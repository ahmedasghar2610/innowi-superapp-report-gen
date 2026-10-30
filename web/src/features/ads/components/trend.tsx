"use client";

import { useState } from "react";
import { Card, Select, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { TrendChart } from "@/features/gbp/components/trend-chart";
import { useAccountTrend } from "../api";
import { fmtMoney, fmtNum, fmtRange } from "../lib";
import type { Campaign, PeriodQuery, TrendPoint } from "../types";
import { NoData, Section } from "./parts";

/*
 * Daily trend for one Google Ads account (or one of its campaigns), from the
 * synced daily rows — never estimated. One y-axis per view, so money, customer
 * actions, clicks and impressions each get their own view. A single metric
 * also shows the comparison period as a dashed line (day 1 ↔ day 1).
 */

type Mode = "money" | "actions" | "clicks" | "impressions";
type Key = Exclude<keyof TrendPoint, "date">;

const MODES: { key: Mode; label: string }[] = [
  { key: "money", label: "Spend & revenue" },
  { key: "actions", label: "Customer actions" },
  { key: "clicks", label: "Clicks" },
  { key: "impressions", label: "Impressions" },
];

// Colour follows the metric (fixed slots, same as the GBP trend), never the selection order.
const METRICS: Record<Mode, { key: Key; label: string; color: string }[]> = {
  money: [
    { key: "spend", label: "Spend", color: "var(--series-6)" },
    { key: "revenue", label: "Revenue", color: "var(--series-5)" },
  ],
  actions: [
    { key: "orders", label: "Orders", color: "var(--series-5)" },
    { key: "calls", label: "Calls", color: "var(--series-2)" },
    { key: "directions", label: "Directions", color: "var(--series-3)" },
    { key: "website", label: "Website", color: "var(--series-1)" },
    { key: "menu", label: "Menu", color: "var(--series-4)" },
  ],
  clicks: [{ key: "clicks", label: "Clicks", color: "var(--chart-1)" }],
  impressions: [{ key: "impressions", label: "Impressions", color: "var(--chart-1)" }],
};

const DEFAULTS: Record<Mode, Key[]> = {
  money: ["spend", "revenue"],
  actions: ["orders", "calls", "directions", "website"],
  clicks: ["clicks"],
  impressions: ["impressions"],
};

const money = (v: number | null | undefined) => (v == null ? "—" : fmtMoney(v, { cents: !Number.isInteger(v) && Math.abs(v) < 100 }));

export function AdsTrend({ accountId, dates, campaigns }: { accountId: string; dates: PeriodQuery; campaigns: Campaign[] }) {
  const [mode, setMode] = useState<Mode>("money");
  const [picked, setPicked] = useState<Record<Mode, Key[]>>(DEFAULTS);
  const [campaign, setCampaign] = useState<string>("");
  const q = useAccountTrend(accountId, { ...dates, ...(campaign ? { campaign } : {}) });
  const t = q.data;

  const on = picked[mode];
  const toggle = (k: Key) =>
    setPicked((cur) => {
      const list = cur[mode];
      const next = list.includes(k) ? (list.length > 1 ? list.filter((x) => x !== k) : list) : [...list, k];
      return { ...cur, [mode]: next };
    });

  const options = t?.campaigns ?? campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status }));
  const series = t ? METRICS[mode].filter((m) => on.includes(m.key)).map((m) => ({ ...m, values: t.days.map((p) => p[m.key]) })) : [];
  const single = series.length === 1;
  const prev = single && t?.previousDays ? t.previousDays.map((p) => p[series[0].key]) : undefined;
  const hasAny = series.some((s) => s.values.some((v) => v != null && v !== 0));
  const noTicket = !!t && t.avgTicket == null && mode === "money" && on.includes("revenue");
  const multi = METRICS[mode].length > 1;

  return (
    <Section
      title="Daily trend"
      aside={
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {options.length > 1 && (
            <div className="w-56">
              <Select value={campaign} aria-label="Campaign" onChange={(e) => setCampaign(e.target.value)}>
                <option value="">All campaigns</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.status === "REMOVED" ? " (removed)" : c.status === "PAUSED" ? " (paused)" : ""}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Chart">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={mode === m.key}
                onClick={() => setMode(m.key)}
                className={cn(
                  "h-7 rounded-md px-2.5 text-xs font-medium whitespace-nowrap",
                  mode === m.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <Card className="flex flex-col gap-3 p-4">
        {multi && (
          <div className="flex flex-wrap items-center gap-1.5 print:hidden" role="group" aria-label="Metrics to show">
            {METRICS[mode].map((m) => {
              const sel = on.includes(m.key);
              return (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={sel}
                  onClick={() => toggle(m.key)}
                  title={sel && on.length === 1 ? "At least one metric stays selected" : undefined}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                    sel ? "border-border bg-card text-foreground" : "border-border bg-muted/50 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="size-2 rounded-full" style={{ background: sel ? m.color : "var(--border)" }} />
                  {m.label}
                </button>
              );
            })}
            {t?.comparePeriod && (
              <span className="ml-1 text-xs text-muted-foreground">
                {single ? `Dashed line: ${fmtRange(t.comparePeriod.start, t.comparePeriod.end)}` : "Pick one metric to compare with the previous period"}
              </span>
            )}
          </div>
        )}
        {!multi && t?.comparePeriod && (
          <span className="text-xs text-muted-foreground print:hidden">Dashed line: {fmtRange(t.comparePeriod.start, t.comparePeriod.end)}</span>
        )}
        {q.error ? (
          <p className="text-sm text-text-destructive">{q.error.messages?.[0] ?? q.error.message}</p>
        ) : !t ? (
          <Skeleton className="h-64 w-full" />
        ) : hasAny ? (
          <TrendChart
            dates={t.days.map((p) => p.date)}
            series={series}
            previous={prev}
            previousDates={t.previousDays?.map((p) => p.date)}
            format={mode === "money" ? money : fmtNum}
            gapNote="Gaps are days after the last refresh — Google hasn't sent them yet, so they aren't counted as zero."
          />
        ) : (
          <div className="grid h-40 place-items-center">
            <NoData label={t.dataThrough ? "No activity in this period" : "No Google Ads data synced yet"} />
          </div>
        )}
        {noTicket && <p className="text-xs text-muted-foreground">Revenue needs the average ticket (the “Average ticket size” card on this page) — until then only spend is drawn.</p>}
      </Card>
    </Section>
  );
}
