"use client";

import { Handshake, Hourglass, Archive, CalendarCheck, CalendarClock, AlarmClock, LifeBuoy } from "lucide-react";
import { Card, ErrorState, SectionHead, StatTile } from "@/components/ui";
import { formatDay } from "../format";
import { useSalesSummary } from "../queries";
import { SalesPageHeader, useSalesContext } from "./sales-shell";
import { CasesTable, DealsTable, VisitsTable } from "./sales-tables";
import { SalesOverview } from "./insights/sales-overview";

/**
 * /sales — "My Day". The animated overview (how sales are going) first, then
 * what needs doing today: visits due or overdue, deals that have gone quiet,
 * and open support cases on the person's restaurants.
 */
export function MyDayPage() {
  const { me, ownerQuery } = useSalesContext();
  const { data, isPending, isError, error, refetch } = useSalesSummary(ownerQuery);
  const showOwner = me.seeAll && !ownerQuery.ownerId;
  const c = data?.counts;

  return (
    <div className="flex flex-col gap-6">
      <SalesPageHeader
        title="My Day"
        description={data ? `How sales are going, and what needs attention on ${formatDay(data.today)}.` : "How sales are going, and what needs attention today."}
      />

      <SalesOverview query={ownerQuery} showLeaderboard={showOwner} />

      <SectionHead title="Today" description="Counts link to the matching lists." />

      {isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Open deals" icon={Handshake} value={c?.openDeals ?? 0} loading={isPending} href="/sales/pipeline" />
          <StatTile
            label="No change in 30+ days"
            icon={Hourglass}
            value={c?.stuckDeals ?? 0}
            tone={c && c.stuckDeals > 0 ? "warning" : "ok"}
            status={c && c.stuckDeals > 0 ? "Worth a follow-up" : "All moving"}
            loading={isPending}
            href="/sales/deals?quiet=stuck"
          />
          <StatTile
            label="Visits due today"
            icon={CalendarCheck}
            value={c?.visitsDueToday ?? 0}
            loading={isPending}
            href="/sales/visits?when=today"
          />
          <StatTile
            label="Overdue visits"
            icon={AlarmClock}
            value={c?.visitsOverdue ?? 0}
            tone={c && c.visitsOverdue > 0 ? "danger" : "ok"}
            status={c && c.visitsOverdue > 0 ? "Past their due date" : "None overdue"}
            loading={isPending}
            href="/sales/visits?when=overdue"
          />
          <StatTile
            label="Visits in the next 7 days"
            icon={CalendarClock}
            value={c?.visitsNext7Days ?? 0}
            loading={isPending}
            href="/sales/visits?when=next7"
          />
          <StatTile label="Open support cases" icon={LifeBuoy} value={c?.openCases ?? 0} loading={isPending} href="/sales/cases" />
          <StatTile
            label="Stale deals (6+ months)"
            icon={Archive}
            value={c?.staleDeals ?? 0}
            hint="Still open in Salesforce but untouched for 6 months. Hidden from the pipeline unless you ask for them."
            loading={isPending}
            href="/sales/deals?quiet=stale"
          />
        </div>
      )}

      {!isError && (
        <>
          <section className="flex flex-col gap-3">
            <SectionHead
              title="Visits due"
              description="Open visits by due date: overdue from the last 30 days, today, and the next 7 days (up to 20)."
              link="All visits"
              href="/sales/visits"
            />
            <VisitsTable
              visits={data?.visitsDue ?? []}
              isPending={isPending}
              showOwner={showOwner}
              emptyTitle="No visits due"
              emptyDescription="Nothing overdue and nothing scheduled for the next week."
            />
          </section>

          <section className="flex flex-col gap-3">
            <SectionHead
              title="Deals that need a nudge"
              description="The 10 open deals that have gone longest without a change in Salesforce (30+ days; 6-month-stale ones left out)."
              link="All deals"
              href="/sales/deals"
            />
            <DealsTable
              deals={data?.stuckDeals ?? []}
              isPending={isPending}
              showOwner={showOwner}
              emptyTitle="Every deal is moving"
              emptyDescription="No open deal has gone 30 days without a change."
            />
          </section>

          <section className="flex flex-col gap-3">
            <SectionHead title="Open support cases" link="All cases" href="/sales/cases" />
            <CasesTable
              cases={data?.openCases ?? []}
              isPending={isPending}
              emptyTitle="No open cases"
              emptyDescription="None of these restaurants has an open support case."
            />
          </section>
        </>
      )}
    </div>
  );
}
