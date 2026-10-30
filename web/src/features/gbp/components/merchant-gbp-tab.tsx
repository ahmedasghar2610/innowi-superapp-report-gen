"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, MapPin } from "lucide-react";
import { Card, EmptyState, ErrorState, Select, SectionHead, Skeleton } from "@/components/ui";
import { ModuleLinksPanel } from "@/features/merchants/components/links/merchant-links";
import { useGbpReport, useGbpStatus, useMerchantListings } from "../api";
import { rangeToParams } from "../lib";
import { DataStatus, Kpis, ProfileCompletion, Reviews, Trend } from "./location-report";
import { DemoBadge, RangeCaption, RangePicker, StatusBadges, useRangeParam } from "./parts";

/**
 * Merchant workspace → GBP: how this merchant's Google Business Profile listing is doing —
 * customer actions, views, the trend, reviews and profile completeness — from the same data as
 * the listing's report. Linking lives in the small Connections panel underneath (GBP API access
 * is still pending, so it says so).
 */
export function MerchantGbpTab({ merchantId }: { merchantId: string }) {
  const listings = useMerchantListings(merchantId);
  const status = useGbpStatus();
  const range = useRangeParam(status.data?.dataThrough ?? null);
  const [picked, setPicked] = useState<string | null>(null);
  const rows = listings.data?.data ?? [];
  const id = picked && rows.some((l) => l.id === picked) ? picked : rows[0]?.id;

  return (
    <div className="flex flex-col gap-4">
      <SectionHead
        title="Google Business Profile"
        description="Customer actions, views and reviews of this merchant's Google listing."
        action={
          id ? (
            <div className="flex flex-wrap items-center gap-2">
              {rows.length > 1 && (
                <div className="w-64">
                  <Select value={id} aria-label="Which listing" onChange={(e) => setPicked(e.target.value)}>
                    {rows.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                        {l.city ? ` — ${l.city}` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <RangePicker state={range.state} through={status.data?.dataThrough ?? null} onChange={(s) => range.set(s)} />
            </div>
          ) : undefined
        }
      />
      {listings.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : !id ? (
        <Card>
          <EmptyState
            icon={MapPin}
            title="No Google Business Profile listing linked"
            description="Google hasn't approved GBP API access yet, so listings can't be pulled or linked automatically. Once it's connected, this merchant's listing stats show up here."
          />
        </Card>
      ) : (
        <ListingStats id={id} dates={range.dates} qs={new URLSearchParams(rangeToParams(range.state)).toString()} />
      )}
      <ModuleLinksPanel merchantId={merchantId} module="gbp" />
    </div>
  );
}

function ListingStats({ id, dates, qs }: { id: string; dates: { start?: string; end?: string }; qs: string }) {
  const q = useGbpReport(id, dates);
  const r = q.data;
  if (q.error) return <ErrorState title="Couldn't load this listing" description={q.error.messages?.[0] ?? q.error.message} />;
  if (!r) return <Skeleton className="h-96 w-full" />;
  const loc = r.location;
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
            {loc.title}
            {loc.isDemo && <DemoBadge />}
          </span>
          {loc.address && <span className="text-xs text-muted-foreground">{loc.address}</span>}
        </div>
        <StatusBadges openStatus={loc.openStatus} verification={loc.verification} syncState={loc.syncState} showVerified showOpen />
        <RangeCaption start={r.range.start} end={r.range.end} prevStart={r.previous.start} prevEnd={r.previous.end} through={r.dataThrough} />
        <Link href={`/web/gbp/${loc.id}?${qs}`} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Full report
          <ArrowUpRight className="size-4" />
        </Link>
      </Card>
      <DataStatus r={r} />
      <Kpis r={r} />
      <Trend r={r} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Reviews r={r} />
        <ProfileCompletion r={r} />
      </div>
    </div>
  );
}
