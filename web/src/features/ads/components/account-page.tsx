"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, MessageSquareWarning, Printer } from "lucide-react";
import { Badge, Button, Card, ErrorState, Select, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useAccount, useAdsStatus, usePortfolio } from "../api";
import {
  fmtDateTime,
  fmtDay,
  fmtMoney,
  fmtMoneyShort,
  fmtNum,
  fmtPct,
  fmtRange,
  fmtRoas,
  fmtShort,
  fmtSignedMoney,
  fmtSignedPct,
  periodLabel,
  downloadCsv,
  changeCsv,
  type Better,
} from "../lib";
import type { AccountDetail } from "../types";
import { AccountSettings } from "./account-settings";
import { AssetsTab, ContentTab, SitelinksTab } from "./assets-tabs";
import { BreakdownTab } from "./breakdown-tab";
import { CampaignsTab } from "./campaigns-tab";
import { CommentsPanel } from "./comments-panel";
import { MerchantLink } from "./merchant-link";
import { OffersTab } from "./offers-tab";
import { AlertBadges, CompareToggle, Delta, DemoBadge, Fact, PeriodPicker, RestaurantStatusBadge, RoasValue, Section, SyncBadge, usePeriodParam, VerificationBadge } from "./parts";
import { AdsTrend } from "./trend";

const TAB_KEYS = ["campaigns", "weekly", "assets", "content", "offers", "sitelinks", "analysis"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export function AccountPage({ id }: { id: string }) {
  const router = useRouter();
  const status = useAdsStatus();
  const period = usePeriodParam();
  const q = useAccount(id, period.dates);
  const list = usePortfolio(period.dates);
  const d = q.data;
  const tabParam = period.query.get("tab") as TabKey | null;
  const tab: TabKey = tabParam && TAB_KEYS.includes(tabParam) ? tabParam : "campaigns";
  const setTab = (t: string) => period.set(period.state, { tab: t === "campaigns" ? undefined : t, month: period.query.get("month") ?? undefined });
  useEffect(() => {
    if (d?.name) document.title = `${d.name} — Google Ads — Innowi`;
  }, [d?.name]);

  if (q.error) return <ErrorState title="Couldn't load this account" description={q.error.messages?.[0] ?? q.error.message} />;
  if (!d) return <Skeleton className="h-[40rem] w-full" />;
  const canManage = !!status.data?.canManage;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href={`/ads?${period.qs}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden">
            <ArrowLeft className="size-4" />
            Back to portfolio
          </Link>
          <h1 className="text-xl font-semibold tracking-[-0.006em] text-foreground">{d.name}</h1>
          <RestaurantStatusBadge status={d.restaurantStatus} />
          <AlertBadges alerts={d.alerts} all />
          {d.isDemo && <DemoBadge />}
          <div className="ml-auto flex items-center gap-2 print:hidden">
            <div className="w-60">
              <Select value={d.id} aria-label="Switch restaurant" onChange={(e) => router.push(`/ads/${e.target.value}?${period.qs}`)}>
                {(list.data?.rows ?? [{ id: d.id, name: d.name }])
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            </div>
            <CompareToggle on={period.compare} onChange={period.setCompare} period={d.comparePeriod} />
            <PeriodPicker state={period.state} onChange={(s) => period.set(s, { tab: period.query.get("tab") ?? undefined })} />
          </div>
        </div>
        {d.address && <p className="-mt-2 text-sm text-muted-foreground">{d.address}</p>}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <Fact label="Google Ads customer ID">
            <span className="font-mono">{d.customerId}</span>
          </Fact>
          <Fact label="Connected GBP" hint="A Google Business Profile listing linked to the same merchant (Web & Search → GBP).">
            {d.gbp.connected ? (
              <span className="flex flex-col">
                <Badge tone="success" className="w-fit">Connected</Badge>
                <span className="text-xs font-normal text-muted-foreground">
                  {d.gbp.listings.map((l) => (
                    <Link key={l.id} href={`/web/gbp/${l.id}`} className="hover:underline">
                      {l.city ?? l.title}
                    </Link>
                  ))}
                </span>
              </span>
            ) : (
              <Badge tone="neutral" className="w-fit">Not connected</Badge>
            )}
          </Fact>
          <Fact label="Verification">
            <VerificationBadge v={d.verification} />
          </Fact>
          <Fact label="Data last synced">
            <span className="flex flex-col gap-0.5">
              <span className="w-fit">
                <SyncBadge s={d.syncState} />
              </span>
              <span className="text-xs font-normal text-muted-foreground">{fmtDateTime(d.lastSyncedAt)}</span>
            </span>
          </Fact>
          <Fact label="Phone">{d.phone ?? <span className="text-muted-foreground">—</span>}</Fact>
        </div>
        {(d.verificationMessage && (d.verification === "required" || d.verification === "failed" || d.verification === "pending")) && (
          <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-text">
            <MessageSquareWarning className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide">Message from Google</div>
              {d.verificationMessage}
              {d.verificationDeadline && <> Deadline: {fmtDay(d.verificationDeadline.slice(0, 10))}.</>}
            </div>
          </div>
        )}
        {d.syncError && <p className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">Last sync failed: {d.syncError}</p>}
        {d.syncWarning && !d.syncError && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Synced with gaps: {d.syncWarning}</p>}
        <MerchantLink account={d} canManage={canManage} />
      </Card>

      <Section
        title="Performance"
        aside={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Period: {periodLabel(period.state)} · {fmtRange(d.period.start, d.period.end)}
              {d.comparePeriod && <> · vs {fmtRange(d.comparePeriod.start, d.comparePeriod.end)}</>}
            </span>
            <Button size="sm" variant="outline" className="print:hidden" onClick={() => exportCsv(d)}>
              <Download className="size-4" />
              CSV
            </Button>
            <Button size="sm" variant="outline" className="print:hidden" onClick={() => window.print()}>
              <Printer className="size-4" />
              PDF
            </Button>
          </div>
        }
      >
        <AccountKpis d={d} />
        {d.analysis && (
          <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
            <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Analysis</span>
            {d.analysis}
          </p>
        )}
      </Section>

      <AdsTrend accountId={d.id} dates={period.dates} campaigns={d.campaigns} />

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <BudgetPanel d={d} />
        <AccountSettings account={d} canManage={canManage} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="print:hidden">
          <TabsTrigger value="campaigns" count={d.tabCounts.campaigns}>Campaigns</TabsTrigger>
          <TabsTrigger value="weekly">Weekly report</TabsTrigger>
          <TabsTrigger value="assets" count={d.tabCounts.assets}>Assets</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="offers" count={d.tabCounts.offers}>Offers</TabsTrigger>
          <TabsTrigger value="sitelinks" count={d.tabCounts.sitelinks}>Sitelinks</TabsTrigger>
          <TabsTrigger value="analysis">Analysis / Future Actions</TabsTrigger>
        </TabsList>
        <TabsContent value="campaigns" className="pt-3">
          <CampaignsTab d={d} />
        </TabsContent>
        <TabsContent value="weekly" className="pt-3">
          {tab === "weekly" && (
            <BreakdownTab accountId={d.id} month={period.query.get("month") ?? undefined} onMonth={(m) => period.set(period.state, { tab: "weekly", month: m })} />
          )}
        </TabsContent>
        <TabsContent value="assets" className="pt-3">
          {tab === "assets" && <AssetsTab accountId={d.id} />}
        </TabsContent>
        <TabsContent value="content" className="pt-3">
          {tab === "content" && <ContentTab accountId={d.id} />}
        </TabsContent>
        <TabsContent value="offers" className="pt-3">
          {tab === "offers" && <OffersTab accountId={d.id} />}
        </TabsContent>
        <TabsContent value="sitelinks" className="pt-3">
          {tab === "sitelinks" && <SitelinksTab accountId={d.id} />}
        </TabsContent>
        <TabsContent value="analysis" className="pt-3">
          {tab === "analysis" && <CommentsPanel accountId={d.id} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Spend · impressions · actions · orders · revenue · ROI · ROAS for the period, and "no data" when empty.
 *  With a comparison period, each tile also shows the change against it. */
export function AccountKpis({ d }: { d: AccountDetail }) {
  const p = d.previous;
  const cp = d.comparePeriod;
  const tiles: { label: string; value: React.ReactNode; cur: number | null; prev: number | null | undefined; better?: Better; points?: boolean; fmt: (v: number | null) => string }[] = [
    { label: "Spend", value: fmtMoneyShort(d.metrics.spend), cur: d.metrics.spend, prev: p?.metrics.spend, better: "none", fmt: fmtMoneyShort },
    { label: "Impressions", value: fmtShort(d.metrics.impressions), cur: d.metrics.impressions, prev: p?.metrics.impressions, fmt: fmtShort },
    { label: "Calls", value: fmtNum(d.metrics.calls), cur: d.metrics.calls, prev: p?.metrics.calls, fmt: fmtNum },
    { label: "Directions", value: fmtNum(d.metrics.directions), cur: d.metrics.directions, prev: p?.metrics.directions, fmt: fmtNum },
    { label: "Website", value: fmtNum(d.metrics.website), cur: d.metrics.website, prev: p?.metrics.website, fmt: fmtNum },
    { label: "Menu", value: fmtNum(d.metrics.menu), cur: d.metrics.menu, prev: p?.metrics.menu, fmt: fmtNum },
    { label: "Orders", value: fmtNum(d.metrics.orders), cur: d.metrics.orders, prev: p?.metrics.orders, fmt: fmtNum },
    { label: "Revenue", value: fmtMoneyShort(d.revenue), cur: d.revenue, prev: p?.revenue, fmt: fmtMoneyShort },
    { label: "ROI", value: fmtPct(d.roi), cur: d.roi, prev: p?.roi, points: true, fmt: fmtPct },
    { label: "ROAS", value: <RoasValue key="r" roas={d.roas} status={d.roasStatus} />, cur: d.roas, prev: p?.roas, fmt: fmtRoas },
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 xl:grid-cols-10">
        {tiles.map((t) => (
          <div key={t.label} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t.label}</span>
            <span className="text-lg font-semibold tabular-nums text-foreground">{t.value}</span>
            {p && cp && (
              <Delta
                cur={t.cur}
                prev={t.prev}
                better={t.better}
                points={t.points}
                title={`${fmtRange(cp.start, cp.end)}: ${t.fmt(t.prev ?? null)}`}
                className="truncate"
              />
            )}
          </div>
        ))}
      </div>
      {!d.hasData && <p className="text-xs text-muted-foreground">No Google Ads data in this period.</p>}
      {p && cp && (
        <p className="text-xs text-muted-foreground">
          Changes compare with {fmtRange(cp.start, cp.end)}
          {!p.hasData && " — no Google Ads data was synced for that period"}. Hover a change to see the earlier value.
        </p>
      )}
    </>
  );
}

export function BudgetPanel({ d }: { d: AccountDetail }) {
  const b = d.budget;
  const statusChip =
    b.status === "mismatch" ? (
      <Badge tone="warning">Budget Mismatch</Badge>
    ) : b.status === "on_track" ? (
      <Badge tone="success">On Track</Badge>
    ) : (
      <Badge tone="neutral">No approved budget</Badge>
    );
  return (
    <Section title="Budget" aside={<span className="flex items-center gap-2 text-xs text-muted-foreground">Budget period: {fmtMonthName(b.month)} {statusChip}</span>}>
      <Card className="grid grid-cols-2 gap-x-6 gap-y-4 p-4 md:grid-cols-3">
        <Fact label="Approved monthly budget" hint="Monthly budget approved by the restaurant owner. Source: Client Profiling (Google Ads Budget).">
          {b.approvedMonthly == null ? <span className="text-muted-foreground">{d.merchant ? "Not set on the Profile" : "Link a merchant first"}</span> : fmtMoney(b.approvedMonthly)}
        </Fact>
        <Fact label="Ads paid by" hint="Who is responsible for paying the ad spend. Source: Client Profiling. Informational only — it does not affect any calculation.">
          {d.adsPaidBy ?? <span className="text-muted-foreground">—</span>}
        </Fact>
        <Fact label="Google Ads daily budget" hint="Every campaign's configured daily budget added together, whatever its status. Source: Google Ads.">
          {fmtMoney(b.googleDailyBudget, { cents: true })}
        </Fact>
        <Fact label="Combined daily budget" hint="Daily budgets of active campaigns only. Paused campaigns are excluded because they do not spend, so this drives the projection.">
          {fmtMoney(b.combinedDailyBudget, { cents: true })}
        </Fact>
        <Fact label="Month-to-date spend" hint="Actual spend within the budget month, independent of the performance period above.">
          {fmtMoney(b.monthToDateSpend, { cents: true })}
          {b.spendThrough && <span className="ml-1 text-xs font-normal text-muted-foreground">through {fmtDay(b.spendThrough, false)}</span>}
        </Fact>
        <Fact label="Remaining monthly budget" hint="Approved monthly budget − month-to-date spend.">
          <span className={cn(b.remaining != null && b.remaining < 0 && "text-text-destructive")}>{b.remaining == null ? "—" : fmtMoney(b.remaining, { cents: true })}</span>
        </Fact>
        <Fact label="Projected monthly spend" hint="Combined daily budget × days in the budget month. This is what the Budget Mismatch alert is based on.">
          {fmtMoney(b.projectedMonthly, { cents: true })}
        </Fact>
        <Fact label="Projected at current pace" hint="Actual spend so far plus the daily budget for the days remaining. Shown for context; the mismatch alert deliberately does not use it.">
          {fmtMoney(b.projectedAtPace, { cents: true })}
        </Fact>
        <Fact label="Variance vs approved" hint={`Projected monthly spend − approved monthly budget. Flagged beyond ±${b.tolerancePct}%.`}>
          <span className={cn(b.status === "mismatch" && "text-warning-text")}>
            {fmtSignedMoney(b.variance)} · {fmtSignedPct(b.variancePct)}
          </span>
        </Fact>
      </Card>
    </Section>
  );
}

function fmtMonthName(ym: string) {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function exportCsv(d: AccountDetail) {
  const cp = d.comparePeriod;
  const cmpHead = cp ? [`Previous spend (${cp.start} to ${cp.end})`, "Previous orders", "Previous revenue", "Previous ROAS", "Spend change", "Orders change", "Revenue change", "ROAS change"] : [];
  const cmpCells = (cur: { metrics: { spend: number; orders: number }; revenue: number | null; roas: number | null }, prev: AccountDetail["previous"]) =>
    cp
      ? [
          prev?.metrics.spend ?? "", prev?.metrics.orders ?? "", prev?.revenue?.toFixed(2) ?? "N/A", prev?.roas?.toFixed(2) ?? "N/A",
          changeCsv(cur.metrics.spend, prev?.metrics.spend), changeCsv(cur.metrics.orders, prev?.metrics.orders), changeCsv(cur.revenue, prev?.revenue), changeCsv(cur.roas, prev?.roas),
        ]
      : [];
  downloadCsv(`google-ads-${d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${d.period.start}-to-${d.period.end}.csv`, [
    [`Google Ads — ${d.name}`, d.customerId, `${d.period.start} to ${d.period.end}`, ...(cp ? [`compared with ${cp.start} to ${cp.end}`] : [])],
    [],
    ["Campaign", "Status", "Daily budget", "Spend", "Impressions", "Clicks", "Calls", "Directions", "Website", "Menu", "Orders", "Cost per order", "Revenue", "ROI %", "ROAS", "ROAS status", "Analysis", ...cmpHead],
    ...d.campaigns.map((c) => [
      c.name, c.status, c.dailyBudget, c.metrics.spend, c.metrics.impressions, c.metrics.clicks, c.metrics.calls, c.metrics.directions, c.metrics.website, c.metrics.menu,
      c.metrics.orders, c.costPerOrder?.toFixed(2) ?? "N/A", c.revenue?.toFixed(2) ?? "N/A", c.roi?.toFixed(2) ?? "N/A", c.roas?.toFixed(2) ?? "N/A", c.roasStatus.label, c.analysis ?? "",
      ...cmpCells(c, c.previous),
    ]),
    [],
    ["Total", "", d.googleDailyBudget, d.metrics.spend, d.metrics.impressions, d.metrics.clicks, d.metrics.calls, d.metrics.directions, d.metrics.website, d.metrics.menu,
      d.metrics.orders, d.costPerOrder?.toFixed(2) ?? "N/A", d.revenue?.toFixed(2) ?? "N/A", d.roi?.toFixed(2) ?? "N/A", fmtRoas(d.roas), d.roasStatus.label, d.analysis ?? "",
      ...cmpCells(d, d.previous)],
  ]);
}
