"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SectionHead, Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { hasCapability } from "@/features/auth/capabilities";
import { IntegrationsStrip } from "./components/integrations-strip";
import { MiaSummary } from "./components/mia-summary";
import { KpiCard } from "./components/kpi-card";
import { IssueCard } from "./components/issue-card";
import { LiveChangeCard } from "./components/live-change-card";
import { RecommendationCard } from "./components/recommendation-card";
import { PortfolioHealth } from "./components/portfolio-health";
import { CardsSkeleton, ConnectNote, DataThrough, EmptyNote, SampleNote, varied } from "./components/live-bits";
import { useCommandCenter } from "./live/use-command-center";
import { useLiveChanges } from "./live/changes";

/**
 * Command Center (route: /command-center; / is the assistant). Marketing
 * roles only: anyone else is sent back to the assistant.
 */
export function HomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const marketing = hasCapability(user?.role, "profile.view");
  useEffect(() => {
    if (user && !marketing) router.replace("/");
  }, [user, marketing, router]);
  if (user === undefined || (user && !marketing)) return null;
  return <CommandCenter />;
}

/**
 * Home / Command Center — Figma "Home / Command Center — Light"
 * (Super App - Marketing Ops · node 7:90). Eight stacked sections, 24px apart,
 * now built from live module data (features/home/live): Google Business
 * Profile, Google Ads, integrations, merchant profiles, tickets and the audit
 * log. Sections with no source yet say so instead of showing sample numbers.
 */
function CommandCenter() {
  const cc = useCommandCenter();
  const changes = useLiveChanges(6);
  const range = `Last ${cc.days} days  vs  previous period`;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Command Center</h1>

      {cc.integrations ? <IntegrationsStrip data={cc.integrations} /> : <Skeleton className="h-[46px] w-full rounded-lg" />}

      {!cc.loading && <ConnectNote cc={cc} />}
      <SampleNote cc={cc} />

      {cc.summary ? (
        <MiaSummary confidence={cc.summary.confidence} segments={cc.summary.segments} />
      ) : cc.loading ? (
        <Skeleton className="h-[132px] w-full rounded-lg" />
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHead title="Core KPIs" link={range} href="/reports" action={<DataThrough cc={cc} />} />
        {cc.kpis.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {cc.kpis.map((k) => (
              <KpiCard key={k.key} kpi={k} />
            ))}
          </div>
        ) : cc.loading ? (
          <CardsSkeleton count={6} cols="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" />
        ) : (
          <EmptyNote>No KPI sources yet — connect Google Business Profile or Google Ads.</EmptyNote>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="Needs Attention" link={`View all ${cc.issues.length} issues`} href="/issues" />
        {cc.loading && !cc.issues.length ? (
          <CardsSkeleton count={4} />
        ) : cc.issues.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {varied(cc.issues, 8).map((i) => (
              <IssueCard key={i.id} item={i} />
            ))}
          </div>
        ) : (
          <EmptyNote>Nothing needs attention right now.</EmptyNote>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="What Changed" link="View change log" href="/changes" />
        {!changes.allowed ? (
          <EmptyNote>The change log comes from the audit log, which only admins can see.</EmptyNote>
        ) : changes.loading ? (
          <CardsSkeleton count={4} height="h-[100px]" />
        ) : changes.changes.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {changes.changes.map((c) => (
              <LiveChangeCard key={c.id} item={c} />
            ))}
          </div>
        ) : (
          <EmptyNote>No changes logged yet.</EmptyNote>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="Opportunities" link="View all opportunities" href="/issues?kind=opportunities" />
        {cc.loading && !cc.opportunities.length ? (
          <CardsSkeleton count={2} />
        ) : cc.opportunities.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {varied(cc.opportunities, 5).map((o) => (
              <IssueCard key={o.id} item={o} />
            ))}
          </div>
        ) : (
          <EmptyNote>No opportunities found for this period.</EmptyNote>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="Recommended Actions" link={`${cc.recommendations.length} suggested`} href="/issues" />
        {cc.loading && !cc.recommendations.length ? (
          <CardsSkeleton count={2} height="h-[198px]" />
        ) : cc.recommendations.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {cc.recommendations.map((r) => (
              <RecommendationCard key={r.id} item={r} />
            ))}
          </div>
        ) : (
          <EmptyNote>No actions to suggest right now.</EmptyNote>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="Portfolio Health by dimension" link="Open reports" href="/reports" />
        {cc.health.length ? (
          <PortfolioHealth data={cc.health} collapsed={cc.collapsed} />
        ) : cc.loading ? (
          <CardsSkeleton count={4} height="h-[116px]" cols="sm:grid-cols-2 xl:grid-cols-4" />
        ) : (
          <EmptyNote>No health data yet.</EmptyNote>
        )}
      </section>
    </div>
  );
}
