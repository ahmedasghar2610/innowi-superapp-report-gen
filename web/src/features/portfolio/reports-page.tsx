"use client";

import Link from "next/link";
import { ChevronRight, FileChartColumn, Globe, MapPin, Search, Target, type LucideIcon } from "lucide-react";
import { SectionHead } from "@/components/ui";
import { KpiCard } from "@/features/home/components/kpi-card";
import { PortfolioHealth } from "@/features/home/components/portfolio-health";
import { CardsSkeleton, ConnectNote, DataThrough, EmptyNote, SampleNote } from "@/features/home/components/live-bits";
import { useCommandCenter } from "@/features/home/live/use-command-center";
import { PageHeader } from "./filter-pills";

const MODULE_REPORTS: { title: string; description: string; href: string; icon: LucideIcon }[] = [
  { title: "Ads monthly report", description: "Spend, clicks and conversions per account", href: "/ads/monthly-report", icon: Target },
  { title: "GBP performance", description: "Google Business Profile views and actions", href: "/web/gbp", icon: MapPin },
  { title: "SEO", description: "Keyword rankings and organic clicks", href: "/web/seo", icon: Search },
  { title: "Websites", description: "Site status and publishing across merchants", href: "/web/website", icon: Globe },
  { title: "Team reports", description: "Ticket throughput and SLA by person", href: "/ops/reports", icon: FileChartColumn },
];

/**
 * /reports — portfolio reporting from live module data: the Core KPIs and
 * Portfolio Health from the Command Center, plus links to each module's own
 * report.
 */
export function ReportsPage() {
  const cc = useCommandCenter();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reports" description={`Portfolio performance · last ${cc.days} days vs the previous ${cc.days}.`} action={<DataThrough cc={cc} />} />
      {!cc.loading && <ConnectNote cc={cc} />}
      <SampleNote cc={cc} />

      <section className="flex flex-col gap-3">
        <SectionHead title="Core KPIs" />
        {cc.kpis.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {cc.kpis.map((k) => (
              <KpiCard key={k.key} kpi={k} />
            ))}
          </div>
        ) : cc.loading ? (
          <CardsSkeleton count={6} cols="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" />
        ) : (
          <EmptyNote>No KPI sources yet.</EmptyNote>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="Portfolio Health by dimension" link="See issues" href="/issues" />
        {cc.health.length ? (
          <PortfolioHealth data={cc.health} collapsed={cc.collapsed} />
        ) : cc.loading ? (
          <CardsSkeleton count={4} height="h-[116px]" cols="sm:grid-cols-2 xl:grid-cols-4" />
        ) : (
          <EmptyNote>No health data yet.</EmptyNote>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="Module reports" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MODULE_REPORTS.map(({ title, description, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary-border"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-5 text-foreground">{title}</span>
                <span className="block truncate text-xs leading-4 text-muted-foreground">{description}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
