"use client";

import { KanbanSquare } from "lucide-react";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { MERCHANT_STATUS_LABEL, MERCHANT_STATUS_TONE, STAGE_LABEL, formatDay, money, stagePhase } from "../labels";
import type { DealBoard as Board, DealRow, StageColumn } from "../types";

/**
 * Kanban by stage: the four sales columns, then the onboarding columns, then
 * Live. Cards open the drawer, where the stage is changed with a select —
 * there is no drag and drop on purpose (phones, and a stage change has side
 * effects on the merchant that deserve a deliberate click).
 */
export function DealBoard({
  board,
  isPending,
  isError,
  error,
  onRetry,
  onSelect,
  busy,
}: {
  board?: Board;
  isPending: boolean;
  isError: boolean;
  error?: ApiError | null;
  onRetry?: () => void;
  onSelect: (deal: DealRow) => void;
  busy?: boolean;
}) {
  if (isError) {
    return (
      <Card>
        <ErrorState title="Couldn't load the board" error={error} onRetry={onRetry} />
      </Card>
    );
  }
  if (isPending || !board) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }
  if (board.total === 0) {
    return (
      <Card>
        <EmptyState icon={KanbanSquare} title="No deals yet" description="Start one with “New deal” — the restaurant becomes a prospect merchant at the same time." />
      </Card>
    );
  }
  const sales = board.columns.filter((c) => stagePhase(c.stage) === "sales");
  const onboarding = board.columns.filter((c) => stagePhase(c.stage) === "onboarding");
  const live = board.columns.find((c) => c.stage === "LIVE");

  return (
    <div className={cn("flex flex-col gap-4", busy && "opacity-60 transition-opacity")} aria-busy={busy} data-testid="deal-board">
      <Phase title="Selling" columns={sales} onSelect={onSelect} />
      <Phase title="Onboarding" columns={onboarding} onSelect={onSelect} />
      {live ? <Phase title="Live" columns={[live]} onSelect={onSelect} compact /> : null}
    </div>
  );
}

function Phase({ title, columns, onSelect, compact }: { title: string; columns: StageColumn[]; onSelect: (d: DealRow) => void; compact?: boolean }) {
  return (
    <section>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{title}</p>
      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "sm:grid-cols-2", !compact && columns.length === 4 && "lg:grid-cols-4", !compact && columns.length === 5 && "lg:grid-cols-5")}>
        {columns.map((col) => (
          <Column key={col.stage} col={col} onSelect={onSelect} horizontal={compact} />
        ))}
      </div>
    </section>
  );
}

function Column({ col, onSelect, horizontal }: { col: StageColumn; onSelect: (d: DealRow) => void; horizontal?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border bg-muted/40" data-testid={`board-column-${col.stage}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 truncate text-xs font-semibold text-foreground">{STAGE_LABEL[col.stage]}</span>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular">
          {col.count}
          {Number(col.monthly) > 0 ? ` · ${money(col.monthly, { compact: true })}/mo` : ""}
        </span>
      </div>
      <div className={cn("flex gap-2 p-2 pt-0", horizontal ? "flex-row flex-wrap" : "flex-col")}>
        {col.deals.length === 0 ? (
          <p className="px-1 pb-2 text-xs text-muted-foreground">—</p>
        ) : (
          col.deals.map((d) => <DealCard key={d.id} deal={d} onSelect={onSelect} className={horizontal ? "w-full sm:w-[260px]" : undefined} />)
        )}
      </div>
    </div>
  );
}

export function DealCard({ deal, onSelect, className }: { deal: DealRow; onSelect: (d: DealRow) => void; className?: string }) {
  const amount = deal.amountMonthly ? `${money(deal.amountMonthly)}/mo` : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(deal)}
      data-testid="deal-card"
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-md border border-border bg-card p-2.5 text-left hover:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{deal.restaurantName}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular">{deal.key}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={MERCHANT_STATUS_TONE[deal.merchantStatus]} icon={false}>
          {MERCHANT_STATUS_LABEL[deal.merchantStatus]}
        </Badge>
        {deal.organization ? <span className="truncate text-xs text-muted-foreground">{deal.organization.name}</span> : null}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{deal.owner?.name ?? "Unassigned"}</span>
        <span className="shrink-0 tabular">{amount ?? (deal.demoAt && deal.stage === "DEMO_BOOKED" ? `demo ${formatDay(deal.demoAt)}` : formatDay(deal.stageChangedAt))}</span>
      </div>
    </button>
  );
}
