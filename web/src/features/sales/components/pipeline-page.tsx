"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, ErrorState, Skeleton } from "@/components/ui";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { formatDay } from "../format";
import { usePipeline } from "../queries";
import { DealFlag } from "./sales-badges";
import { SalesPageHeader, useSalesContext } from "./sales-shell";
import type { Deal, PipelineColumn } from "../types";

const CLOSED_WITHIN_DAYS = 90;

/**
 * /sales/pipeline — a read-only board. Open columns follow Salesforce's stage
 * order; the ~29 retired stages are folded into "In deployment" / "Other open"
 * (api/app/modules/salesforce/stages.py). Closed columns only show the last
 * 90 days so years of history don't drown the board.
 */
export function PipelinePage() {
  const { me, ownerQuery } = useSalesContext();
  const [includeStale, setIncludeStale] = useState(false);
  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = usePipeline({
    ...ownerQuery,
    includeStale,
    closedWithinDays: CLOSED_WITHIN_DAYS,
  });
  const showOwner = me.seeAll && !ownerQuery.ownerId;

  return (
    <div>
      <SalesPageHeader
        title="Salesforce pipeline"
        description={
          data
            ? `${data.openCount} open deal${data.openCount === 1 ? "" : "s"} · ${formatUsd(data.openAmount)}. Changes are made in Salesforce.`
            : "Open deals by stage. Changes are made in Salesforce."
        }
        actions={
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-4 cursor-pointer rounded border-border accent-primary"
              checked={includeStale}
              onChange={(e) => setIncludeStale(e.target.checked)}
            />
            Show stale deals
            {data && !includeStale && data.staleHidden > 0 && (
              <span className="text-muted-foreground">({data.staleHidden} hidden)</span>
            )}
          </label>
        }
      />

      {isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-72 shrink-0" />
          ))}
        </div>
      ) : (
        <div
          className={cn("flex gap-3 overflow-x-auto pb-3", isFetching && isPlaceholderData && "opacity-60 transition-opacity")}
          role="list"
          aria-label="Pipeline columns"
        >
          {data.columns.map((col) => (
            <PipelineColumnView key={col.key} col={col} showOwner={showOwner} includeStale={includeStale} />
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineColumnView({ col, showOwner, includeStale }: { col: PipelineColumn; showOwner: boolean; includeStale: boolean }) {
  const params = new URLSearchParams({ column: col.key, state: col.isOpen ? "open" : "closed" });
  if (includeStale) params.set("stale", "1");
  const more = col.count - col.deals.length;

  return (
    <section
      role="listitem"
      aria-label={col.label}
      className="flex max-h-[calc(100vh-220px)] w-72 shrink-0 flex-col rounded-[var(--radius-card)] border border-border bg-muted"
    >
      <header className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold text-foreground" title={col.label}>
            {col.label}
          </h2>
          <span className="rounded-full bg-card px-2 text-xs font-medium tabular text-foreground">{col.count}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {formatUsd(col.amount)}
          {!col.isOpen && ` · closed in the last ${CLOSED_WITHIN_DAYS} days`}
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {col.deals.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">No deals</p>}
        {col.deals.map((d) => (
          <DealCard key={d.id} deal={d} showOwner={showOwner} />
        ))}
        {more > 0 && (
          <Link
            href={`/sales/deals?${params.toString()}`}
            className="rounded-md px-2 py-1.5 text-center text-xs font-medium text-primary hover:bg-card"
          >
            {col.isOpen ? `See all ${col.count}` : "See full history"}
          </Link>
        )}
      </div>
    </section>
  );
}

function DealCard({ deal, showOwner }: { deal: Deal; showOwner: boolean }) {
  return (
    <Link
      href={`/sales/deals/${deal.id}`}
      className="block rounded-md border border-border bg-card p-2.5 text-sm transition-colors hover:border-primary"
    >
      <p className="truncate font-medium text-foreground" title={deal.name}>
        {deal.name}
      </p>
      {deal.accountName && <p className="truncate text-xs text-muted-foreground">{deal.accountName}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {deal.amount != null && <span className="font-medium tabular text-foreground">{formatUsd(deal.amount)}</span>}
        {deal.closeDate && <span>Close {formatDay(deal.closeDate)}</span>}
        {showOwner && deal.ownerName && <span>· {deal.ownerName}</span>}
      </div>
      {deal.columnLabel !== deal.stageName && <p className="mt-1 truncate text-xs text-muted-foreground">{deal.stageName}</p>}
      <div className="mt-1 empty:hidden">
        <DealFlag deal={deal} />
      </div>
    </Link>
  );
}
