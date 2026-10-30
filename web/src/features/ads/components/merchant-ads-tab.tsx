"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Target } from "lucide-react";
import { Card, EmptyState, ErrorState, Select, SectionHead, Skeleton } from "@/components/ui";
import { ModuleLinksPanel } from "@/features/merchants/components/links/merchant-links";
import { useAccount, useMerchantAds } from "../api";
import type { PeriodQuery } from "../types";
import { fmtDateTime, fmtRange, periodLabel } from "../lib";
import { AccountKpis, BudgetPanel } from "./account-page";
import { CampaignsTab } from "./campaigns-tab";
import { AlertBadges, CompareToggle, DemoBadge, PeriodPicker, RestaurantStatusBadge, Section, SyncBadge, usePeriodParam } from "./parts";
import { AdsTrend } from "./trend";

/**
 * Merchant workspace → Google Ads: how this merchant's ads are doing — spend, actions, orders,
 * revenue, ROI / ROAS for the period, the budget and the campaigns — from the same data as the
 * account's page in the Ads module. Linking lives in the small Connections panel underneath.
 */
export function MerchantAdsTab({ merchantId }: { merchantId: string }) {
  const accounts = useMerchantAds(merchantId);
  const period = usePeriodParam();
  const [picked, setPicked] = useState<string | null>(null);
  const rows = accounts.data?.data ?? [];
  const id = picked && rows.some((a) => a.id === picked) ? picked : rows[0]?.id;

  return (
    <div className="flex flex-col gap-4">
      <SectionHead
        title="Google Ads"
        description="Results of this merchant's Google Ads for the chosen period."
        action={
          id ? (
            <div className="flex flex-wrap items-center gap-2">
              {rows.length > 1 && (
                <div className="w-64">
                  <Select value={id} aria-label="Which account" onChange={(e) => setPicked(e.target.value)}>
                    {rows.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <CompareToggle on={period.compare} onChange={period.setCompare} />
              <PeriodPicker state={period.state} onChange={(s) => period.set(s)} />
            </div>
          ) : undefined
        }
      />
      {accounts.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : !id ? (
        <Card>
          <EmptyState
            icon={Target}
            title="No Google Ads account linked yet"
            description="Link this merchant's account below (suggestions come from its name) and its spend, orders and ROAS show up here. The approved budget and “Ads paid by” come from the Profile."
          />
        </Card>
      ) : (
        <AccountStats id={id} dates={period.dates} label={periodLabel(period.state)} qs={period.qs} />
      )}
      <ModuleLinksPanel merchantId={merchantId} module="ads" />
    </div>
  );
}

function AccountStats({ id, dates, label, qs }: { id: string; dates: PeriodQuery; label: string; qs: string }) {
  const q = useAccount(id, dates);
  const d = q.data;
  if (q.error) return <ErrorState title="Couldn't load this account" description={q.error.messages?.[0] ?? q.error.message} />;
  if (!d) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
            {d.name}
            <RestaurantStatusBadge status={d.restaurantStatus} />
            {d.isDemo && <DemoBadge />}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{d.customerId}</span>
        </div>
        <AlertBadges alerts={d.alerts} all />
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          <span className="w-fit">
            <SyncBadge s={d.syncState} />
          </span>
          <span>Synced {fmtDateTime(d.lastSyncedAt)}</span>
        </div>
        <Link href={`/ads/${d.id}?${qs}`} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Full account
          <ArrowUpRight className="size-4" />
        </Link>
      </Card>
      <Section title="Performance" aside={<span className="text-xs text-muted-foreground">
              {label} · {fmtRange(d.period.start, d.period.end)}
              {d.comparePeriod && <> · vs {fmtRange(d.comparePeriod.start, d.comparePeriod.end)}</>}
            </span>}>
        <AccountKpis d={d} />
        {d.analysis && (
          <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
            <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Analysis</span>
            {d.analysis}
          </p>
        )}
      </Section>
      <AdsTrend accountId={d.id} dates={dates} campaigns={d.campaigns} />
      <BudgetPanel d={d} />
      <Section title="Campaigns">
        <CampaignsTab d={d} />
      </Section>
    </div>
  );
}
