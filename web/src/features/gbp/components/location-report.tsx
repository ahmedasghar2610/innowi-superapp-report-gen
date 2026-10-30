"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Circle, Download, ExternalLink, MessageSquareReply, Printer, Star } from "lucide-react";
import { Badge, Button, Card, ErrorState, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useGbpOverview, useGbpReport, useGbpStatus } from "../api";
import { changeText, downloadCsv, fmtAgo, fmtDay, fmtMonth, fmtNum, rangeToParams, VERIFICATION } from "../lib";
import type { LocationReport, SeriesPoint, Total } from "../types";
import { MerchantLink } from "./merchant-link";
import { NotesPanel } from "./notes-panel";
import { ChangeLine, DemoBadge, NoData, RangeCaption, RangePicker, Section, StatusBadges, useRangeParam } from "./parts";
import { TrendChart } from "./trend-chart";

type Metric = keyof Omit<SeriesPoint, "date">;
const METRICS: { key: Metric; label: string }[] = [
  { key: "total", label: "Customer actions" },
  { key: "views", label: "Profile views" },
  { key: "website", label: "Website clicks" },
  { key: "calls", label: "Calls" },
  { key: "directions", label: "Directions" },
  { key: "menu", label: "Menu clicks" },
  { key: "orders", label: "Orders" },
];

export function LocationReportPage({ id }: { id: string }) {
  const router = useRouter();
  const status = useGbpStatus();
  const through = status.data?.dataThrough ?? null;
  const range = useRangeParam(through);
  const keywordMonth = range.query.get("month") ?? undefined;
  const report = useGbpReport(id, { ...range.dates, keywordMonth });
  const list = useGbpOverview(range.dates);
  const r = report.data;
  const rangeQs = new URLSearchParams(rangeToParams(range.state)).toString();
  const title = r?.location.title;
  useEffect(() => {
    if (title) document.title = `${title} — Google Business Profile — Innowi`;
  }, [title]);

  if (report.error) {
    return <ErrorState title="Couldn't load this listing" description={report.error.messages?.[0] ?? report.error.message} />;
  }
  if (!r) return <Skeleton className="h-[40rem] w-full" />;
  const loc = r.location;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href={`/web/gbp?${rangeQs}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden">
            <ArrowLeft className="size-4" />
            All listings
          </Link>
          <h1 className="text-xl font-semibold tracking-[-0.006em] text-foreground">{loc.title}</h1>
          <StatusBadges openStatus={loc.openStatus} verification={loc.verification} syncState={loc.syncState} showVerified showOpen />
          {loc.isDemo && <DemoBadge />}
          <div className="ml-auto w-64 print:hidden">
            <Select
              value={loc.id}
              aria-label="Switch listing"
              onChange={(e) => router.push(`/web/gbp/${e.target.value}?${rangeQs}`)}
            >
              {(list.data?.rows ?? [{ id: loc.id, title: loc.title, city: loc.city }])
                .slice()
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                    {l.city ? ` — ${l.city}` : ""}
                  </option>
                ))}
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {loc.address && <span>{loc.address}</span>}
          {loc.phone && <span>{loc.phone}</span>}
          {loc.primaryCategory && <span>{loc.primaryCategory}</span>}
          {loc.storeCode && <span>Store code {loc.storeCode}</span>}
          {[
            ["Google Maps", loc.mapsUri],
            ["Website", loc.websiteUrl],
            ["Menu", loc.menuUrl],
            ["Ordering", loc.orderingUrl],
          ]
            .filter(([, u]) => u)
            .map(([label, u]) => (
              <a key={label} href={u as string} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline print:hidden">
                {label}
                <ExternalLink className="size-3.5" />
              </a>
            ))}
        </div>
        <MerchantLink locationId={loc.id} merchant={loc.merchant} canManage={!!status.data?.canManage} />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <RangePicker state={range.state} through={through} onChange={(s) => range.set(s, { month: keywordMonth })} />
        <RangeCaption start={r.range.start} end={r.range.end} prevStart={r.previous.start} prevEnd={r.previous.end} through={r.dataThrough} />
        <div className="ml-auto flex gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={() => exportReport(r)}>
            <Download className="size-4" />
            CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" />
            PDF
          </Button>
        </div>
      </div>

      <DataStatus r={r} />
      <Kpis r={r} />
      <Insights r={r} />
      <Trend r={r} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Visibility r={r} />
        <Keywords r={r} month={keywordMonth} onMonth={(m) => range.set(range.state, { month: m })} />
      </div>
      <Reviews r={r} />
      <div className="grid gap-6 xl:grid-cols-2">
        <ProfileCompletion r={r} />
        <Posts r={r} />
      </div>
      <NotesPanel locationId={loc.id} />
    </div>
  );
}

export function DataStatus({ r }: { r: LocationReport }) {
  const loc = r.location;
  const lines: { tone: "danger" | "warning" | "neutral"; text: string }[] = [];
  if (loc.syncError) lines.push({ tone: "danger", text: `Last sync failed: ${loc.syncError}` });
  if (loc.syncState === "delayed" && loc.lastMetricsDate)
    lines.push({ tone: "warning", text: `This listing's numbers stop at ${fmtDay(loc.lastMetricsDate)}; the rest of the network runs to ${fmtDay(r.dataThrough)}.` });
  if (r.missingDays > 0 && r.daysWithData > 0)
    lines.push({ tone: "neutral", text: `${r.missingDays} of ${r.range.days} days in this range have no data yet and are left out (not counted as zero).` });
  if (loc.syncWarning) lines.push({ tone: "neutral", text: `Partly synced — ${loc.syncWarning}` });
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>
        Last synced {fmtAgo(loc.lastSyncedAt)}
        {loc.firstDataDate && <> · data recorded from {fmtDay(loc.firstDataDate)}</>}
      </span>
      {lines.map((l) => (
        <span key={l.text} className={l.tone === "danger" ? "text-text-destructive" : l.tone === "warning" ? "text-warning-text" : undefined}>
          {l.text}
        </span>
      ))}
    </p>
  );
}

function KpiTile({ label, t, hint }: { label: string; t: Total; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3" title={hint}>
      <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
      {t.current == null ? (
        <span className="py-1">
          <NoData label="No data for this period" />
        </span>
      ) : (
        <>
          <span className="text-2xl font-semibold tabular-nums text-foreground">{fmtNum(t.current)}</span>
          <ChangeLine change={t.change} suffix=" vs previous" />
          <span className="text-[11px] text-muted-foreground">Previous: {fmtNum(t.previous)}</span>
        </>
      )}
    </div>
  );
}

export function Kpis({ r }: { r: LocationReport }) {
  const k = r.kpis;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <KpiTile label="Customer actions" t={k.total} hint="Website clicks + calls + directions + menu clicks + orders + bookings" />
      <KpiTile label="Website clicks" t={k.website} />
      <KpiTile label="Calls" t={k.calls} />
      <KpiTile label="Direction requests" t={k.directions} />
      <KpiTile label="Menu clicks" t={k.menu} />
      <KpiTile label="Online orders" t={k.orders} hint="Food orders placed through the Google listing" />
    </div>
  );
}

export function Insights({ r }: { r: LocationReport }) {
  return (
    <Section title="What changed">
      <Card className="p-4">
        <ul className="flex flex-col gap-1.5">
          {r.insights.map((t) => (
            <li key={t} className="flex gap-2 text-sm text-foreground">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
              {t}
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

type ActionMetric = "website" | "calls" | "directions" | "menu" | "orders" | "total";
// Colour follows the metric (fixed slots), never the selection order.
const ACTION_METRICS: { key: ActionMetric; label: string; color: string }[] = [
  { key: "website", label: "Website clicks", color: "var(--series-1)" },
  { key: "calls", label: "Calls", color: "var(--series-2)" },
  { key: "directions", label: "Directions", color: "var(--series-3)" },
  { key: "menu", label: "Menu clicks", color: "var(--series-4)" },
  { key: "orders", label: "Orders", color: "var(--series-5)" },
  { key: "total", label: "All actions", color: "var(--series-7)" },
];
const DEFAULT_ACTIONS: ActionMetric[] = ["website", "calls", "directions", "menu"];

export function Trend({ r }: { r: LocationReport }) {
  // Profile views run ~10× higher than clicks, so they get their own view
  // instead of sharing an axis with the actions (one y-axis per chart).
  const [mode, setMode] = useState<"actions" | "views">("actions");
  const [picked, setPicked] = useState<ActionMetric[]>(DEFAULT_ACTIONS);
  const toggle = (k: ActionMetric) =>
    setPicked((cur) => (cur.includes(k) ? (cur.length > 1 ? cur.filter((x) => x !== k) : cur) : [...cur, k]));

  const dates = r.series.map((p) => p.date);
  const series =
    mode === "views"
      ? [{ key: "views", label: "Profile views", color: "var(--chart-1)", values: r.series.map((p) => p.views) }]
      : ACTION_METRICS.filter((m) => picked.includes(m.key)).map((m) => ({ ...m, values: r.series.map((p) => p[m.key]) }));
  const single = series.length === 1;
  const hasAny = series.some((s) => s.values.some((v) => v != null));

  return (
    <Section
      title="Daily trend"
      aside={
        <div className="flex rounded-lg border border-border bg-card p-0.5 print:hidden" role="group" aria-label="Chart">
          {(
            [
              ["actions", "Customer actions"],
              ["views", "Profile views"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={mode === k}
              onClick={() => setMode(k)}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs font-medium",
                mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <Card className="flex flex-col gap-3 p-4">
        {mode === "actions" && (
          <div className="flex flex-wrap items-center gap-1.5 print:hidden" role="group" aria-label="Metrics to show">
            {ACTION_METRICS.map((m) => {
              const on = picked.includes(m.key);
              return (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(m.key)}
                  title={on && picked.length === 1 ? "At least one metric stays selected" : undefined}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                    on ? "border-border bg-card text-foreground" : "border-border bg-muted/50 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="size-2 rounded-full" style={{ background: on ? m.color : "var(--border)" }} />
                  {m.label}
                </button>
              );
            })}
            <span className="ml-1 text-xs text-muted-foreground">
              {single ? "Dashed line: the previous period" : "Pick one metric to compare with the previous period"}
            </span>
          </div>
        )}
        {hasAny ? (
          <TrendChart
            dates={dates}
            series={series}
            previous={single ? r.previousSeries.map((p) => (mode === "views" ? p.views : p[series[0].key as ActionMetric])) : undefined}
            previousDates={r.previousSeries.map((p) => p.date)}
          />
        ) : (
          <div className="grid h-56 place-items-center">
            <NoData label="No data for this period" />
          </div>
        )}
      </Card>
    </Section>
  );
}

function ShareBar({ label, value, total, t }: { label: string; value: number | null; total: number; t?: Total }) {
  const pct = total > 0 && value != null ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {fmtNum(value)} <span className="text-xs font-normal text-muted-foreground">· {pct}%</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${pct}%` }} />
      </div>
      {t && <ChangeLine change={t.change} />}
    </div>
  );
}

function Visibility({ r }: { r: LocationReport }) {
  const v = r.visibility;
  const total = (v.search.current ?? 0) + (v.maps.current ?? 0);
  return (
    <Section title="Where people found it" aside={<span className="text-xs text-muted-foreground">Profile views this period</span>}>
      <Card className="flex flex-col gap-4 p-4">
        {v.search.current == null ? (
          <NoData label="No data for this period" />
        ) : (
          <>
            <ShareBar label="Google Search" value={v.search.current} total={total} t={v.search} />
            <ShareBar label="Google Maps" value={v.maps.current} total={total} t={v.maps} />
            <div className="border-t border-border pt-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Device</div>
              <div className="flex flex-col gap-3">
                <ShareBar label="Mobile" value={v.mobile} total={(v.mobile ?? 0) + (v.desktop ?? 0)} />
                <ShareBar label="Desktop" value={v.desktop} total={(v.mobile ?? 0) + (v.desktop ?? 0)} />
              </div>
            </div>
          </>
        )}
      </Card>
    </Section>
  );
}

function Keywords({ r, month, onMonth }: { r: LocationReport; month?: string; onMonth: (m: string) => void }) {
  const k = r.keywords;
  const show = (v: number | null, th: number | null) => (v != null ? fmtNum(v) : th != null ? `< ${th}` : "—");
  return (
    <Section
      title="Top search terms"
      aside={
        k.months.length > 0 && (
          <Select value={month ?? k.month ?? ""} onChange={(e) => onMonth(e.target.value)} className="w-44" aria-label="Month">
            {k.months.map((m) => (
              <option key={m} value={m}>
                {fmtMonth(m)}
              </option>
            ))}
          </Select>
        )
      }
    >
      <Card>
        {k.rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No search terms yet. Google reports them per month, after the month ends.</p>
        ) : (
          <>
            <Table className="rounded-none border-0">
              <TableHeader>
                <TableRow>
                  <TableHead>Search term</TableHead>
                  <TableHead align="right">{k.month ? fmtMonth(k.month).split(" ")[0] : "Views"}</TableHead>
                  <TableHead align="right">{k.previousMonth ? fmtMonth(k.previousMonth).split(" ")[0] : "Previous"}</TableHead>
                  <TableHead align="right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {k.rows.map((row) => (
                  <TableRow key={row.keyword}>
                    <TableCell>{row.keyword}</TableCell>
                    <TableCell align="right">{show(row.impressions, row.threshold)}</TableCell>
                    <TableCell align="right" className="text-muted-foreground">
                      {show(row.previous, row.previousThreshold)}
                    </TableCell>
                    <TableCell align="right">
                      <ChangeLine change={row.change} suffix="" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              Monthly totals from Google ({k.total} terms in {k.month ? fmtMonth(k.month) : "this month"}). Google hides exact counts below its threshold (“&lt; 15”).
              Search terms aren&apos;t available for custom date ranges.
            </p>
          </>
        )}
      </Card>
    </Section>
  );
}

export function Reviews({ r }: { r: LocationReport }) {
  const v = r.reviews;
  const max = Math.max(1, ...v.distribution.map((d) => d.count));
  const stored = v.distribution.reduce((a, d) => a + d.count, 0);
  return (
    <Section title="Reviews">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">Average rating</span>
          <span className="inline-flex items-center gap-1 text-2xl font-semibold tabular-nums text-foreground">
            {v.average == null ? <NoData label="No reviews" /> : v.average.toFixed(1)}
            {v.average != null && <Star className="size-5 fill-current text-warning" aria-label="stars" />}
          </span>
          {v.ratingAtPreviousEnd != null && v.ratingAtEnd != null && (
            <span className="text-xs text-muted-foreground">
              {v.ratingAtPreviousEnd.toFixed(2)} → {v.ratingAtEnd.toFixed(2)} over this period
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">Total reviews</span>
          <span className="text-2xl font-semibold tabular-nums text-foreground">{fmtNum(v.total)}</span>
          <span className="text-xs text-muted-foreground">{v.thisMonth} so far this month</span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">New in this period</span>
          <span className="text-2xl font-semibold tabular-nums text-foreground">{fmtNum(v.inRange)}</span>
          <ChangeLine change={v.change} />
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">Without a reply</span>
          <span className={cn("text-2xl font-semibold tabular-nums", v.unansweredInRange ? "text-warning-text" : "text-foreground")}>{fmtNum(v.unansweredInRange)}</span>
          <span className="text-xs text-muted-foreground">of the new reviews in this period</span>
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="p-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Star breakdown (all synced reviews)</div>
          {stored === 0 ? (
            <NoData label="No reviews yet" />
          ) : (
            <div className="flex flex-col gap-1.5">
              {v.distribution.map((d) => (
                <div key={d.stars} className="flex items-center gap-2">
                  <span className="w-8 text-xs tabular-nums text-muted-foreground">{d.stars} ★</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${(d.count / max) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{fmtNum(d.count)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">Latest reviews</div>
          {v.recent.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {v.recent.map((rv, i) => (
                <li key={i} className="flex gap-3 px-4 py-2.5">
                  <span className="w-12 shrink-0 text-sm tabular-nums text-foreground">
                    {rv.rating ?? "–"} <Star className="inline size-3.5 fill-current text-warning" aria-label="stars" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{rv.comment ?? <span className="text-muted-foreground">Rating only, no text</span>}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {rv.reviewer ?? "Google user"} · {fmtDay(rv.date)}
                    </p>
                  </div>
                  {rv.hasReply ? (
                    <Badge tone="success" icon={MessageSquareReply}>
                      Replied
                    </Badge>
                  ) : (
                    <Badge tone="warning">No reply</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Section>
  );
}

export function ProfileCompletion({ r }: { r: LocationReport }) {
  const p = r.profile;
  const done = p.fields.filter((f) => f.done);
  const missing = p.fields.filter((f) => !f.done);
  return (
    <Section title="Profile completion" aside={<span className="text-xs text-muted-foreground">{done.length} of {p.fields.length} fields filled in on Google</span>}>
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-4">
          <span className={cn("text-3xl font-semibold tabular-nums", p.pct < 60 ? "text-warning-text" : "text-foreground")}>{p.pct}%</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${p.pct}%` }} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Missing ({missing.length})</div>
            {missing.length === 0 ? (
              <p className="text-sm text-muted-foreground">Everything tracked is filled in.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {missing.map((f) => (
                  <li key={f.key} className="flex items-center gap-2 text-sm text-foreground">
                    <Circle className="size-3.5 text-muted-foreground" aria-hidden />
                    {f.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Filled in ({done.length})</div>
            <ul className="flex flex-col gap-1">
              {done.map((f) => (
                <li key={f.key} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="size-3.5 text-success-subtle-foreground" aria-hidden />
                  {f.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </Section>
  );
}

function Posts({ r }: { r: LocationReport }) {
  const p = r.posts;
  return (
    <Section title="Posts and offers" aside={<span className="text-xs text-muted-foreground">Read-only — as published on Google</span>}>
      <Card className="flex flex-col">
        <div className="grid grid-cols-3 gap-3 border-b border-border px-4 py-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Posts</div>
            <div className="font-semibold tabular-nums text-foreground">{p.total}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Latest post</div>
            <div className="font-semibold text-foreground">{fmtDay(p.latest)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">In this period</div>
            <div className="font-semibold tabular-nums text-foreground">{p.inRange}</div>
          </div>
        </div>
        {p.items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No posts published from this listing.</p>
        ) : (
          <ul className="divide-y divide-border">
            {p.items.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-foreground">{x.title}</span>
                <span className="text-xs text-muted-foreground">{fmtDay(x.date)}</span>
                {x.state !== "LIVE" && <Badge tone="warning">{x.state.toLowerCase()}</Badge>}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border px-4 py-2 text-xs font-medium text-muted-foreground">Offers</div>
        {p.offers.length === 0 ? (
          <p className="px-4 pb-3 text-sm text-muted-foreground">No offers on this listing.</p>
        ) : (
          <ul className="divide-y divide-border">
            {p.offers.map((x) => (
              <li key={x.id} className="flex items-start gap-3 px-4 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="text-foreground">
                    {x.title}
                    {x.coupon && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Code {x.coupon}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmtDay(x.start)} – {fmtDay(x.end)}
                  </div>
                </div>
                <Badge tone={x.status === "Active" ? "success" : x.status === "Scheduled" ? "accent" : "neutral"} icon={false}>
                  {x.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Section>
  );
}

function exportReport(r: LocationReport) {
  const k = r.kpis;
  const row = (label: string, t: Total) => [label, t.current ?? "No data", t.previous ?? "No data", changeText(t.change, "")];
  downloadCsv(`gbp-${r.location.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${r.range.start}-to-${r.range.end}.csv`, [
    [`GBP report — ${r.location.title}`, `${r.range.start} to ${r.range.end}`, `compared with ${r.previous.start} to ${r.previous.end}`],
    ["Status", r.location.openStatus, "Verification", VERIFICATION[r.location.verification].label, "Sync", r.location.syncState],
    [],
    ["Metric", "This period", "Previous period", "Change"],
    row("Customer actions", k.total),
    row("Website clicks", k.website),
    row("Calls", k.calls),
    row("Direction requests", k.directions),
    row("Menu clicks", k.menu),
    row("Online orders", k.orders),
    row("Search views", r.visibility.search),
    row("Maps views", r.visibility.maps),
    [],
    ["New reviews (period)", r.reviews.inRange],
    ["Reviews without a reply (period)", r.reviews.unansweredInRange],
    ["Total reviews", r.reviews.total],
    ["Average rating", r.reviews.average ?? "No reviews"],
    ["Profile completion %", r.profile.pct],
    ["Posts in period", r.posts.inRange],
    [],
    ["Date", ...METRICS.map((m) => m.label)],
    ...r.series.map((p) => [p.date, ...METRICS.map((m) => p[m.key] ?? "")]),
  ]);
}
