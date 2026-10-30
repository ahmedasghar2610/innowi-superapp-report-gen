"use client";

import { Store, ShieldCheck, TriangleAlert, CircleAlert, Sparkles } from "lucide-react";
import { SectionHead, StatTile } from "@/components/ui";
import { useDataQuality } from "@/features/merchants/api";

/**
 * Portfolio strip above the Merchants directory — the Command Center's
 * "Core KPIs" pattern applied to the directory, read live from
 * `GET /data-quality` (the same numbers the Data Quality screen shows).
 */
export function MerchantPortfolioStats() {
  const { data, isPending, isError } = useDataQuality();
  if (isError) return null;

  const d = data;
  const total = d?.totals.merchants ?? 0;
  const avg = d?.totals.averagePercent;
  const partial = d?.bands.partial ?? 0;
  const critical = d?.bands.critical ?? 0;
  const complete = d?.bands.complete ?? 0;

  return (
    <section className="flex flex-col gap-3" aria-label="Portfolio at a glance">
      <SectionHead title="Portfolio" link="View data quality" href="/data-quality" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Store}
          label="Merchants"
          value={total}
          status={d ? `${d.totals.scored} scored` : ""}
          tone="neutral"
          loading={isPending}
        />
        <StatTile
          icon={Sparkles}
          label="Avg. completeness"
          value={avg == null ? "—" : `${Math.round(avg)}%`}
          status={d ? `${complete} complete` : ""}
          tone={avg != null && d && avg >= d.thresholds.completeAtPct ? "ok" : "neutral"}
          loading={isPending}
        />
        <StatTile
          icon={TriangleAlert}
          label="Need attention"
          value={partial}
          status={partial > 0 ? "partial profiles" : "none"}
          tone={partial > 0 ? "warning" : "ok"}
          loading={isPending}
        />
        <StatTile
          icon={CircleAlert}
          label="Critical"
          value={critical}
          status={critical > 0 ? `below ${d?.thresholds.criticalBelowPct ?? 0}%` : "none"}
          tone={critical > 0 ? "danger" : "ok"}
          loading={isPending}
        />
      </div>
      <span className="sr-only">
        <ShieldCheck aria-hidden /> Data quality thresholds apply.
      </span>
    </section>
  );
}
