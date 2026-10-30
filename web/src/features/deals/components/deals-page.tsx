"use client";

import { useEffect, useRef, useState } from "react";
import { CircleDollarSign, KanbanSquare, List, Plus, Search, ShieldAlert, Trophy, X } from "lucide-react";
import { Button, Card, EmptyState, Select, StatTile } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { useCan } from "@/features/auth/use-can";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { cn } from "@/lib/utils/cn";
import { STAGE_LABEL, money } from "../labels";
import { useDealBoard, useDealList } from "../queries";
import { ALL_STAGES, type DealQuery, type DealStage } from "../types";
import { DealBoard } from "./deal-board";
import { DealDrawer } from "./deal-drawer";
import { DealTable } from "./deal-table";
import { NewDealDialog } from "./new-deal-dialog";

type View = "board" | "list";
type SortKey = NonNullable<DealQuery["sortBy"]>;

interface Filters {
  search: string;
  stage: DealStage | "";
  bucket: "OPEN" | "WON" | "LOST" | "ALL";
  ownerId: string;
  mine: boolean;
  organizationId: string;
}
const EMPTY: Filters = { search: "", stage: "", bucket: "ALL", ownerId: "", mine: false, organizationId: "" };

const INPUT =
  "h-7 rounded-sm border border-border bg-background px-2 text-xs font-medium leading-4 text-foreground placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent";

/** ?deal=<id> opens one deal's drawer; ?view=list picks the list. */
function useUrlState(): [string | null, (id: string | null) => void, View, (v: View) => void] {
  const [id, setId] = useState<string | null>(null);
  const [view, setView] = useState<View>("board");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setId(p.get("deal"));
    if (p.get("view") === "list") setView("list");
  }, []);
  const write = (k: string, v: string | null) => {
    const url = new URL(window.location.href);
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
    window.history.replaceState(null, "", url.toString());
  };
  return [
    id,
    (next) => {
      setId(next);
      write("deal", next);
    },
    view,
    (next) => {
      setView(next);
      write("view", next === "list" ? "list" : null);
    },
  ];
}

/**
 * Deals (route: /deals). One deal = one attempt to put Innowi into one
 * restaurant, from first contact through onboarding to live. The board shows
 * every open deal by stage; the list is the same data as a sortable table.
 */
export function DealsPage() {
  const { user } = useAuth();
  const can = useCan();
  const canView = can("deals.view");
  const canManage = can("deals.manage");
  const [dealId, setDealId, view, setView] = useUrlState();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [sortBy, setSortBy] = useState<SortKey>("updatedAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [newOpen, setNewOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const common: DealQuery = {
    search: filters.search || undefined,
    ownerId: filters.ownerId || undefined,
    mine: filters.mine || undefined,
    organizationId: filters.organizationId || undefined,
  };
  const board = useDealBoard(common, { enabled: canView });
  const list = useDealList(
    { ...common, page, limit, sortBy, order, stage: filters.stage || undefined, bucket: filters.bucket === "ALL" ? undefined : filters.bucket },
    { enabled: canView && view === "list" },
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (user === undefined) return null;
  if (!canView) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="No access" description="Deals are available to Innowi staff roles." />
      </Card>
    );
  }

  const patch = (p: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...p }));
    setPage(1);
  };
  const onSearch = (value: string) => {
    setTerm(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => patch({ search: value.trim() }), 300);
  };
  const onSort = (key: SortKey) => {
    if (key === sortBy) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setOrder(key === "restaurantName" ? "asc" : "desc");
    }
    setPage(1);
  };
  const hasActive = filters.search || filters.stage || filters.bucket !== "ALL" || filters.ownerId || filters.mine || filters.organizationId;
  const b = board.data;
  const open = b ? b.total - b.lost - b.live : 0;
  const pipelineMonthly = b ? b.columns.filter((c) => c.stage !== "LIVE").reduce((n, c) => n + Number(c.monthly || 0), 0) : 0;
  const rows = list.data?.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Deals</h1>
          <p className="mt-1 text-table text-muted-foreground">
            Every restaurant we are trying to win, from first contact to live. A new deal creates the merchant; the stage moves the merchant along.
          </p>
        </div>
        {canManage ? (
          <Button variant="default" size="sm" onClick={() => setNewOpen(true)} data-testid="new-deal">
            <Plus className="size-4" /> New deal
          </Button>
        ) : null}
      </div>

      {!board.isError && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile icon={KanbanSquare} label="Open deals" value={open} status={b ? `${b.total} in total` : ""} loading={board.isPending} />
          <StatTile
            icon={CircleDollarSign}
            label="Pipeline, monthly"
            value={b ? money(pipelineMonthly, { compact: true }) : "—"}
            status="quoted or signed, not yet live"
            loading={board.isPending}
          />
          <StatTile icon={Trophy} label="Live" value={b?.live ?? 0} status={b ? `${b.lost} lost` : ""} tone={b && b.live > 0 ? "ok" : "neutral"} loading={board.isPending} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-sm border border-border p-0.5" role="tablist" aria-label="View">
          {(["board", "list"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-[3px] px-2 text-xs font-medium",
                view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "board" ? <KanbanSquare className="size-3.5" /> : <List className="size-3.5" />}
              {v === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={term}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search restaurant or D-number…"
            aria-label="Search deals"
            className={`${INPUT} w-full pl-8 pr-3`}
          />
        </div>
        <Select
          value={filters.mine ? "mine" : filters.ownerId}
          onChange={(e) => (e.target.value === "mine" ? patch({ mine: true, ownerId: "" }) : patch({ mine: false, ownerId: e.target.value }))}
          aria-label="Filter by owner"
          className="w-[150px]"
        >
          <option value="">Any owner</option>
          <option value="mine">Mine</option>
          {(b?.owners ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Select value={filters.organizationId} onChange={(e) => patch({ organizationId: e.target.value })} aria-label="Filter by organization" className="w-[170px]">
          <option value="">Any organization</option>
          {(b?.organizations ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        {view === "list" ? (
          <>
            <Select value={filters.bucket} onChange={(e) => patch({ bucket: e.target.value as Filters["bucket"], stage: "" })} aria-label="Filter by outcome" className="w-[120px]">
              <option value="ALL">All deals</option>
              <option value="OPEN">Open</option>
              <option value="WON">Live</option>
              <option value="LOST">Lost</option>
            </Select>
            <Select value={filters.stage} onChange={(e) => patch({ stage: e.target.value as DealStage | "", bucket: "ALL" })} aria-label="Filter by stage" className="w-[160px]">
              <option value="">Any stage</option>
              {ALL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        {hasActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTerm("");
              patch(EMPTY);
            }}
          >
            <X className="size-4" />
            Clear
          </Button>
        ) : null}
      </div>

      {view === "board" ? (
        <DealBoard board={b} isPending={board.isPending} isError={board.isError} error={board.error} onRetry={() => board.refetch()} onSelect={(d) => setDealId(d.id)} busy={board.isFetching && board.isPlaceholderData} />
      ) : (
        <div>
          <Card>
            <DealTable
              rows={rows}
              isPending={list.isPending}
              isError={list.isError}
              error={list.error}
              onRetry={() => list.refetch()}
              onSelect={(d) => setDealId(d.id)}
              busy={list.isFetching && list.isPlaceholderData}
              filtered={!!hasActive}
              sortBy={sortBy}
              order={order}
              onSort={onSort}
            />
          </Card>
          {list.data?.meta && rows.length > 0 && (
            <MerchantPagination
              meta={list.data.meta}
              onPageChange={setPage}
              onPageSizeChange={(n) => {
                setLimit(n);
                setPage(1);
              }}
            />
          )}
        </div>
      )}

      <DealDrawer dealId={dealId} owners={b?.owners ?? []} organizations={b?.organizations ?? []} onClose={() => setDealId(null)} />
      <NewDealDialog open={newOpen} onClose={() => setNewOpen(false)} organizations={b?.organizations ?? []} owners={b?.owners ?? []} onCreated={(d) => setDealId(d.id)} />
    </div>
  );
}
