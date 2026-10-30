"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, Search } from "lucide-react";
import { Card, EmptyState, ErrorState, Select, SectionHead, Skeleton } from "@/components/ui";
import { ModuleLinksPanel } from "@/features/merchants/components/links/merchant-links";
import { useMerchantSeo, useSeoSite } from "../api";
import { fmtAgo } from "../lib";
import { DemoBadge, HealthScore } from "./parts";
import { Findings, LocalCard, Performance, Pillars, Queries, TopPages } from "./site-page";

/**
 * Merchant workspace → SEO: the search performance of the SEO sites linked to
 * this merchant — clicks, impressions, CTR, position, visits, the six pillars, top queries and
 * pages, open findings — straight from the same data as the site's scorecard. Linking lives in
 * the small Connections panel underneath.
 */
export function MerchantSeoTab({ merchantId }: { merchantId: string }) {
  const sites = useMerchantSeo(merchantId);
  const [picked, setPicked] = useState<string | null>(null);
  const rows = sites.data?.data ?? [];
  const id = picked && rows.some((s) => s.id === picked) ? picked : rows[0]?.id;

  return (
    <section className="flex flex-col gap-4">
      <SectionHead
        title="SEO"
        description="Search performance of this merchant's website — Search Console, GA4 and the six-pillar scorecard."
        action={
          rows.length > 1 ? (
            <div className="w-72">
              <Select value={id} aria-label="Which site" onChange={(e) => setPicked(e.target.value)}>
                {rows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.domain}
                  </option>
                ))}
              </Select>
            </div>
          ) : undefined
        }
      />
      {sites.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : !id ? (
        <Card>
          <EmptyState
            icon={Search}
            title="No SEO site linked yet"
            description="Link this merchant's website below (suggestions come from its website address and name) and its search performance shows up here."
          />
        </Card>
      ) : (
        <SiteStats id={id} />
      )}
      <ModuleLinksPanel merchantId={merchantId} module="seo" />
    </section>
  );
}

function SiteStats({ id }: { id: string }) {
  const q = useSeoSite(id);
  const d = q.data;
  if (q.error) return <ErrorState title="Couldn't load this site's SEO data" description={q.error.message} />;
  if (!d) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2 text-base font-semibold text-foreground">
            {d.name}
            {d.isDemo && <DemoBadge />}
          </span>
          <a href={d.homeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            {d.domain}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Health</span>
          <HealthScore score={d.health} size="lg" />
        </div>
        <div className="flex flex-col text-xs text-muted-foreground">
          <span>Search Console through {d.sync.gscThrough ?? "—"}</span>
          <span>GA4 through {d.sync.ga4Through ?? "—"}</span>
          <span>Last synced {d.sync.lastSyncedAt ? fmtAgo(d.sync.lastSyncedAt) : "never"}</span>
        </div>
        <Link href={`/web/seo/sites/${d.id}`} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Full scorecard
          <ArrowUpRight className="size-4" />
        </Link>
      </Card>
      <Performance d={d} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Queries d={d} />
        <TopPages d={d} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Findings d={d} />
        <LocalCard d={d} />
      </div>
      <Pillars d={d} />
    </div>
  );
}
