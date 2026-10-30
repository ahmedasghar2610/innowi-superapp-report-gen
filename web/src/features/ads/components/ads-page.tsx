"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
  type SortDirection,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useAdsStatus, usePortfolio } from "../api";
import {
  change,
  changeCsv,
  changeText,
  changeTone,
  downloadCsv,
  fmtDateTime,
  fmtMoney,
  fmtMoneyShort,
  fmtNum,
  fmtPct,
  fmtRange,
  fmtRoas,
  fmtShort,
  periodLabel,
  portfolioTotals,
  RESTAURANT_STATUS,
  VERIFICATION,
  type Better,
} from "../lib";
import type { Portfolio, PortfolioRow } from "../types";
import { ConnectionStrip } from "./connection";
import { AlertBadges, CompareToggle, Delta, DemoBadge, HeadHint, NoData, PeriodPicker, RoasValue, SyncBadge, usePeriodParam, VerificationBadge } from "./parts";

type TabKey = "all" | "active" | "paused" | "budgetMismatch" | "verificationRequired" | "syncIssue" | "archived";
const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "paused", label: "Paused" },
  { key: "budgetMismatch", label: "Budget Mismatch" },
  { key: "verificationRequired", label: "Verification Required" },
  { key: "syncIssue", label: "Sync Issue" },
  { key: "archived", label: "Archived" },
];

function inTab(r: PortfolioRow, tab: TabKey): boolean {
  if (tab === "archived") return r.state === "archived";
  if (r.state !== "active") return false;
  switch (tab) {
    case "all":
      return true;
    case "active":
      return r.restaurantStatus === "active";
    case "paused":
      return r.restaurantStatus === "paused" || r.restaurantStatus === "no_campaigns";
    case "budgetMismatch":
      return r.alerts.some((a) => a.type === "budget_mismatch");
    case "verificationRequired":
      return r.alerts.some((a) => a.type === "verification_required");
    case "syncIssue":
      return r.syncState === "issue";
  }
}

export function AdsPage() {
  const status = useAdsStatus();
  const period = usePeriodParam();
  const portfolio = usePortfolio(period.dates);
  const p = portfolio.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Google Ads Portfolio</h1>
          <p className="mt-1 text-table text-muted-foreground">
            One row per restaurant. All campaigns for a restaurant are combined. Read-only monitoring — nothing here changes Google Ads.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/ads/unmapped"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            Unmapped Accounts
            {p && <Badge tone={p.counts.unlinked ? "warning" : "neutral"} icon={false}>{p.counts.unlinked}</Badge>}
            <ArrowUpRight className="size-4 text-muted-foreground" />
          </Link>
          <Link
            href="/ads/monthly-report"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            <FileSpreadsheet className="size-4" />
            Monthly report
          </Link>
          <CompareToggle on={period.compare} onChange={period.setCompare} period={p?.comparePeriod} />
          <PeriodPicker state={period.state} onChange={(s) => period.set(s)} />
        </div>
      </div>

      {status.data ? <ConnectionStrip status={status.data} /> : <Skeleton className="h-14 w-full" />}

      {portfolio.error ? (
        <ErrorState title="Couldn't load Google Ads" description={portfolio.error.messages?.[0] ?? portfolio.error.message} />
      ) : !p ? (
        <Skeleton className="h-96 w-full" />
      ) : p.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No Google Ads accounts yet"
            description={
              status.data?.connected
                ? "The first refresh is still running, or the manager account has no client accounts the connected user can see."
                : "Connect Google Ads above, import the old sheet's account list on the Unmapped page, or load sample data to try the pages."
            }
          />
        </Card>
      ) : (
        <Body p={p} qs={period.qs} label={periodLabel(period.state)} />
      )}
    </div>
  );
}

type SortKey = "name" | "approvedMonthly" | "googleDailyBudget" | "spend" | "impressions" | "calls" | "directions" | "website" | "menu" | "orders" | "costPerOrder" | "avgTicket" | "revenue" | "roi" | "roas";
const PAGE = 25;

function sortValue(r: PortfolioRow, k: SortKey): number | string | null {
  switch (k) {
    case "name":
      return r.name.toLowerCase();
    case "spend":
    case "impressions":
    case "calls":
    case "directions":
    case "website":
    case "menu":
    case "orders":
      return r.metrics[k];
    default:
      return r[k];
  }
}

function Body({ p, qs, label }: { p: Portfolio; qs: string; label: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });
  const [page, setPage] = useState(1);

  const counts: Record<TabKey, number> = {
    all: p.counts.all,
    active: p.counts.active,
    paused: p.counts.paused,
    budgetMismatch: p.counts.budgetMismatch,
    verificationRequired: p.counts.verificationRequired,
    syncIssue: p.counts.syncIssue,
    archived: p.counts.archived,
  };
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/-/g, "");
    const list = p.rows.filter(
      (r) => inTab(r, tab) && (!q || r.name.toLowerCase().includes(q) || r.customerId.replace(/-/g, "").includes(q) || (r.merchant?.name ?? "").toLowerCase().includes(q)),
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av == null && bv == null) return a.name.localeCompare(b.name);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * dir;
      return (av - bv) * dir || a.name.localeCompare(b.name);
    });
  }, [p.rows, tab, search, sort]);
  const t = portfolioTotals(rows);
  const cp = p.comparePeriod;
  // Totals of the comparison period over the same restaurants (ticket sizes are the current ones).
  const pt = cp && rows.every((r) => r.previous) ? portfolioTotals(rows.map((r) => ({ ...r, ...r.previous! }))) : null;
  const vs = (cur: number | null, prev: number | null | undefined, better: Better = "up"): { status?: string; tone?: "ok" | "danger" | "neutral" } => {
    if (!pt || !cp) return {};
    const c = change(cur, prev);
    const tone = changeTone(c, better);
    return { status: changeText(c), tone: tone === "good" ? "ok" : tone === "bad" ? "danger" : "neutral" };
  };
  const roiPts = pt && t.roi != null && pt.roi != null ? Math.round(t.roi - pt.roi) : null;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const safe = Math.min(page, pages);
  const slice = rows.slice((safe - 1) * PAGE, safe * PAGE);
  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
  const dirOf = (key: SortKey): SortDirection => (sort.key === key ? sort.dir : false);
  const tabLabel = TABS.find((x) => x.key === tab)!.label;

  const head = (key: SortKey, labelText: string, hint?: string) => (
    <TableHead key={key} align="right" sortable sortDirection={dirOf(key)} onSort={() => sortBy(key)} className="whitespace-nowrap">
      <HeadHint label={labelText} hint={hint} />
    </TableHead>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Search restaurants</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} placeholder="Search restaurant name or customer ID" className="pl-8" />
        </label>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter restaurants">
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tab === x.key}
              onClick={() => (setTab(x.key), setPage(1))}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                tab === x.key ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-secondary",
              )}
            >
              {x.label}
              <span className={cn("rounded px-1.5 tabular-nums", tab === x.key ? "bg-background/20" : "bg-muted text-muted-foreground")}>{counts[x.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatTile label="Restaurants" value={rows.length} />
        <StatTile label="Active" value={rows.filter((r) => r.restaurantStatus === "active").length} />
        <StatTile label="Paused" value={rows.filter((r) => r.restaurantStatus === "paused" || r.restaurantStatus === "no_campaigns").length} />
        <StatTile
          label="Total spend"
          value={fmtMoneyShort(t.spend)}
          {...vs(t.spend, pt?.spend, "none")}
          hint={`Sum of ad spend across all displayed restaurants for the selected performance period.${pt && cp ? ` Previous period (${fmtRange(cp.start, cp.end)}): ${fmtMoneyShort(pt.spend)}.` : ""}`}
        />
        <StatTile
          label="Total orders"
          value={fmtShort(t.orders)}
          {...vs(t.orders, pt?.orders)}
          hint={`Google Ads store action orders (location-asset orders), all displayed restaurants.${pt && cp ? ` Previous period: ${fmtShort(pt.orders)}.` : ""}`}
        />
        <StatTile
          label="Total revenue"
          value={fmtMoneyShort(t.revenue)}
          {...(t.withoutRevenue ? { status: `${t.withoutRevenue} without avg ticket`, tone: "warning" as const } : vs(t.revenue, pt?.revenue))}
          hint={`Sum of each restaurant's orders × its average ticket size. Restaurants without a ticket size are left out.${pt && cp ? ` Previous period: ${fmtMoneyShort(pt.revenue)}.` : ""}`}
        />
        <StatTile
          label="Overall ROI"
          value={<span className="text-primary">{fmtPct(t.roi)}</span>}
          {...(pt && cp
            ? {
                status: roiPts == null ? "No earlier data" : roiPts === 0 ? "No change" : `${roiPts > 0 ? "▲" : "▼"} ${Math.abs(roiPts)} pts`,
                tone: roiPts == null || roiPts === 0 ? ("neutral" as const) : roiPts > 0 ? ("ok" as const) : ("danger" as const),
              }
            : {})}
          hint={`((Total revenue − ad spend) ÷ ad spend) × 100, from portfolio totals (restaurants with a ticket size), not an average of each restaurant's ROI.${pt && cp ? ` Previous period: ${fmtPct(pt.roi)}.` : ""}`}
        />
        <StatTile
          label="Overall ROAS"
          value={<span className="text-primary">{fmtRoas(t.roas)}</span>}
          {...vs(t.roas, pt?.roas)}
          hint={`Total revenue ÷ ad spend, from portfolio totals (restaurants with a ticket size), not an average of each restaurant's ROAS.${pt && cp ? ` Previous period: ${fmtRoas(pt.roas)}.` : ""}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground">
          Showing: {tabLabel} — {rows.length} restaurant{rows.length === 1 ? "" : "s"} · Performance period: {label} ({fmtRange(p.period.start, p.period.end)})
          {cp && <> · compared with {fmtRange(cp.start, cp.end)}</>} · Budget month:{" "}
          {p.budgetMonth}
          {p.dataThrough && <> · Google data through {fmtRange(p.dataThrough, p.dataThrough)}</>}
        </p>
        <Button size="sm" variant="outline" onClick={() => exportCsv(rows, p)} className="print:hidden">
          <Download className="size-4" />
          CSV
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead sortable sortDirection={dirOf("name")} onSort={() => sortBy("name")} className="sticky left-0 z-10 min-w-56 bg-card">
              Restaurant
            </TableHead>
            <TableHead className="whitespace-nowrap">
              <HeadHint label="Campaign status" hint="Active when at least one campaign is enabled." />
            </TableHead>
            {head("approvedMonthly", "Approved monthly", "Monthly budget approved by the owner. Source: Client Profiling (Google Ads Budget).")}
            <TableHead className="whitespace-nowrap">
              <HeadHint label="Ads paid by" hint="Who is responsible for paying the ad spend. Source: Client Profiling." />
            </TableHead>
            {head("googleDailyBudget", "Google Ads daily budget", "Combined daily budget of active campaigns. Paused campaigns are excluded because they do not spend. Source: Google Ads.")}
            {head("spend", "Ad spend")}
            {head("impressions", "Impressions")}
            {head("calls", "Calls")}
            {head("directions", "Directions")}
            {head("website", "Website")}
            {head("menu", "Menu")}
            {head("orders", "Orders", "Google Ads store action orders.")}
            {head("costPerOrder", "Cost / order", "Ad spend ÷ orders. Not available when there are no orders.")}
            {head("avgTicket", "Avg ticket", "Average online order value: total sales ÷ orders, entered per account (Innowi Online Ordering).")}
            {head("revenue", "Revenue", "Orders × average ticket size.")}
            {head("roi", "ROI", "((Revenue − ad spend) ÷ ad spend) × 100.")}
            {head("roas", "ROAS", "Revenue ÷ ad spend. Colour = n8n ROAS status: ≥4 excellent · ≥2.5 good · ≥1 break-even · <1 unprofitable.")}
            <TableHead>Verification</TableHead>
            <TableHead>Alerts</TableHead>
            <TableHead className="whitespace-nowrap">Last synced</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {slice.map((r) => (
            <TableRow key={r.id} interactive onClick={() => router.push(`/ads/${r.id}?${qs}`)}>
              <TableCell className="sticky left-0 z-10 min-w-56 max-w-72 bg-card">
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-8 w-0.5 shrink-0 rounded-full", r.alerts.length ? "bg-warning" : r.restaurantStatus === "active" ? "bg-success" : "bg-border")} aria-hidden />
                  <div className="min-w-0">
                    <Link href={`/ads/${r.id}?${qs}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-foreground hover:underline">
                      {r.name}
                    </Link>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-mono">{r.customerId}</span>
                      {!r.merchant && <Badge tone="warning" icon={false}>Not linked</Badge>}
                      {r.isDemo && <DemoBadge />}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <Badge tone={RESTAURANT_STATUS[r.restaurantStatus].tone}>{RESTAURANT_STATUS[r.restaurantStatus].label}</Badge>
                <div className="mt-0.5 text-xs text-muted-foreground">{r.campaignSummary}</div>
              </TableCell>
              <TableCell align="right" className="whitespace-nowrap">
                {r.approvedMonthly == null ? <NoData label="Not set" /> : <>{fmtMoney(r.approvedMonthly, { cents: false })}<div className="text-xs text-muted-foreground">/ month</div></>}
              </TableCell>
              <TableCell>{r.adsPaidBy ? <Badge tone="neutral" icon={false}>{r.adsPaidBy}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell align="right" className="whitespace-nowrap">
                {fmtMoney(r.googleDailyBudget, { cents: false })}
                <div className="text-xs text-muted-foreground">/ day</div>
              </TableCell>
              {r.hasData ? (
                <>
                  <TableCell align="right">
                    {fmtMoney(r.metrics.spend, { cents: false })}
                    {r.previous && <Delta cur={r.metrics.spend} prev={r.previous.metrics.spend} better="none" className="block" title={`Previous: ${fmtMoney(r.previous.metrics.spend, { cents: false })}`} />}
                  </TableCell>
                  <TableCell align="right">{fmtNum(r.metrics.impressions)}</TableCell>
                  <TableCell align="right">{fmtNum(r.metrics.calls)}</TableCell>
                  <TableCell align="right">{fmtNum(r.metrics.directions)}</TableCell>
                  <TableCell align="right">{fmtNum(r.metrics.website)}</TableCell>
                  <TableCell align="right">{fmtNum(r.metrics.menu)}</TableCell>
                  <TableCell align="right">
                    {fmtNum(r.metrics.orders)}
                    {r.previous && <Delta cur={r.metrics.orders} prev={r.previous.metrics.orders} className="block" title={`Previous: ${fmtNum(r.previous.metrics.orders)}`} />}
                  </TableCell>
                </>
              ) : (
                <TableCell colSpan={7} align="center">
                  <NoData label="No data in this period" />
                </TableCell>
              )}
              <TableCell align="right">{r.costPerOrder == null ? <NoData label="N/A" /> : fmtMoney(r.costPerOrder)}</TableCell>
              <TableCell align="right">{r.avgTicket == null ? <NoData label="Not set" /> : fmtMoney(r.avgTicket)}</TableCell>
              <TableCell align="right">
                {r.revenue == null ? <NoData label="N/A" /> : fmtMoney(r.revenue, { cents: false })}
                {r.previous && r.revenue != null && (
                  <Delta cur={r.revenue} prev={r.previous.revenue} className="block" title={`Previous: ${fmtMoney(r.previous.revenue, { cents: false })}`} />
                )}
              </TableCell>
              <TableCell align="right" className={cn(r.roi != null && r.roi < 0 && "text-text-destructive")}>
                {fmtPct(r.roi)}
              </TableCell>
              <TableCell align="right">
                <RoasValue roas={r.roas} status={r.roasStatus} />
                {r.previous && r.roas != null && <Delta cur={r.roas} prev={r.previous.roas} className="block" title={`Previous: ${fmtRoas(r.previous.roas)}`} />}
              </TableCell>
              <TableCell>
                <VerificationBadge v={r.verification} />
              </TableCell>
              <TableCell>
                <AlertBadges alerts={r.alerts} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {r.syncState === "ok" ? fmtDateTime(r.lastSyncedAt) : <SyncBadge s={r.syncState} />}
              </TableCell>
            </TableRow>
          ))}
          {slice.length === 0 && (
            <TableMessageRow colSpan={20}>
              <p className="py-6 text-center text-sm text-muted-foreground">No restaurants match.</p>
            </TableMessageRow>
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between print:hidden">
        <span className="text-xs text-muted-foreground">
          Showing {rows.length ? (safe - 1) * PAGE + 1 : 0}–{Math.min(safe * PAGE, rows.length)} of {rows.length} · page {safe} of {pages}
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" disabled={safe <= 1} onClick={() => setPage(safe - 1)} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="outline" disabled={safe >= pages} onClick={() => setPage(safe + 1)} aria-label="Next page">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </>
  );
}

function exportCsv(rows: PortfolioRow[], p: Portfolio) {
  const cp = p.comparePeriod;
  const header = [
    "Restaurant", "Customer ID", "Merchant", "Status", "Campaigns", "Approved monthly", "Ads paid by", "Daily budget", "Ad spend", "Impressions",
    "Calls", "Directions", "Website", "Menu", "Orders", "Cost per order", "Avg ticket", "Revenue", "ROI %", "ROAS", "ROAS status", "Verification", "Alerts",
    ...(cp ? [`Previous spend (${cp.start} to ${cp.end})`, "Previous orders", "Previous revenue", "Previous ROAS", "Spend change", "Orders change", "Revenue change", "ROAS change"] : []),
  ];
  downloadCsv(`google-ads-portfolio-${p.period.start}-to-${p.period.end}.csv`, [
    ["Google Ads portfolio", `${p.period.start} to ${p.period.end}`, ...(cp ? [`compared with ${cp.start} to ${cp.end}`] : [])],
    [],
    header,
    ...rows.map((r) => [
      r.name, r.customerId, r.merchant?.name ?? "", RESTAURANT_STATUS[r.restaurantStatus].label, r.campaignSummary, r.approvedMonthly, r.adsPaidBy,
      r.googleDailyBudget, r.metrics.spend, r.metrics.impressions, r.metrics.calls, r.metrics.directions, r.metrics.website, r.metrics.menu, r.metrics.orders,
      r.costPerOrder?.toFixed(2) ?? "N/A", r.avgTicket?.toFixed(2) ?? "", r.revenue?.toFixed(2) ?? "N/A", r.roi?.toFixed(2) ?? "N/A", r.roas?.toFixed(2) ?? "N/A",
      r.roasStatus.label, VERIFICATION[r.verification].label, r.alerts.map((a) => a.label).join("; "),
      ...(cp
        ? [
            r.previous?.metrics.spend ?? "", r.previous?.metrics.orders ?? "", r.previous?.revenue?.toFixed(2) ?? "N/A", r.previous?.roas?.toFixed(2) ?? "N/A",
            changeCsv(r.metrics.spend, r.previous?.metrics.spend), changeCsv(r.metrics.orders, r.previous?.metrics.orders), changeCsv(r.revenue, r.previous?.revenue),
            changeCsv(r.roas, r.previous?.roas),
          ]
        : []),
    ]),
  ]);
}
