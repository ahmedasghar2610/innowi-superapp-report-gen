"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, CircleDollarSign, Search, ShieldAlert, Trophy, Upload, UserMinus, X } from "lucide-react";
import { Button, Card, EmptyState, Select, StatTile } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { useCan } from "@/features/auth/use-can";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { WINBACK_LABEL, money, monthLabel } from "../labels";
import { useChurnList, useChurnSummary } from "../queries";
import { WINBACK_STATUSES, type ChurnQuery, type ChurnSummary, type WinbackStatus } from "../types";
import { ChurnDrawer } from "./churn-drawer";
import { ChurnImportDialog } from "./churn-import-dialog";
import { ChurnTable } from "./churn-table";

interface Filters {
  search: string;
  region: string;
  category: string;
  csm: string;
  winbackStatus: WinbackStatus | "";
  ownerId: string;
  mine: boolean;
  churnedFrom: string;
  churnedTo: string;
}
const EMPTY: Filters = { search: "", region: "", category: "", csm: "", winbackStatus: "", ownerId: "", mine: false, churnedFrom: "", churnedTo: "" };
type SortKey = NonNullable<ChurnQuery["sortBy"]>;

const INPUT =
  "h-7 rounded-sm border border-border bg-background px-2 text-xs font-medium leading-4 text-foreground placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent";

/** Read ?merchant=<id> so a link can open one account's drawer directly. */
function useMerchantParam(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("merchant"));
  }, []);
  const set = (next: string | null) => {
    setId(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("merchant", next);
    else url.searchParams.delete("merchant");
    window.history.replaceState(null, "", url.toString());
  };
  return [id, set];
}

/**
 * Churned accounts (route: /churn). Every row is a merchant with status
 * CHURNED: the CSM team's churn workbooks are imported here, and the sales
 * team works the win-back from the same list.
 */
export function ChurnPage() {
  const { user } = useAuth();
  const can = useCan();
  const canView = can("churn.view");
  const canImport = can("churn.import");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [term, setTerm] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("churnedOn");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [importOpen, setImportOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [merchantId, setMerchantId] = useMerchantParam();

  const query: ChurnQuery = {
    page,
    limit,
    sortBy,
    order,
    search: filters.search || undefined,
    region: filters.region || undefined,
    category: filters.category || undefined,
    csm: filters.csm || undefined,
    winbackStatus: filters.winbackStatus || undefined,
    ownerId: filters.ownerId || undefined,
    mine: filters.mine || undefined,
    churnedFrom: filters.churnedFrom || undefined,
    churnedTo: filters.churnedTo || undefined,
  };
  const list = useChurnList(query, { enabled: canView });
  const summary = useChurnSummary({ enabled: canView });

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (user === undefined) return null;
  if (!canView) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="No access" description="Churned accounts are available to Innowi staff roles." />
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
  const hasActive = Object.entries(filters).some(([, v]) => v !== "" && v !== false);
  const s = summary.data;
  const wonBack = s?.byWinback.find((b) => b.key === "WON_BACK")?.count ?? 0;
  const inPlay = (s?.byWinback ?? []).filter((b) => b.key === "CONTACTED" || b.key === "IN_TALKS").reduce((n, b) => n + b.count, 0);
  const rows = list.data?.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Churned accounts</h1>
          <p className="mt-1 text-table text-muted-foreground">
            Restaurants that left Innowi, with why they left and the win-back work. Each one is a merchant with status Churned.
          </p>
        </div>
        {canImport ? (
          <Button variant="default" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" /> Import workbook
          </Button>
        ) : null}
      </div>

      {!summary.isError && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={UserMinus} label="Churned accounts" value={s?.total ?? 0} status={s ? `${s.withReason} with a recorded reason` : ""} loading={summary.isPending} />
          <StatTile
            icon={CircleDollarSign}
            label="MRR lost"
            value={s ? money(s.mrrLost, { compact: true }) : "—"}
            status={s ? `${money(s.gpvLost, { compact: true })} monthly GPV at churn` : ""}
            tone="danger"
            loading={summary.isPending}
          />
          <StatTile icon={CalendarClock} label="Being worked" value={inPlay} status="contacted or in talks" tone={inPlay > 0 ? "warning" : "neutral"} loading={summary.isPending} />
          <StatTile icon={Trophy} label="Won back" value={wonBack} status={wonBack > 0 ? "active again" : "none yet"} tone={wonBack > 0 ? "ok" : "neutral"} loading={summary.isPending} />
        </div>
      )}

      {s && s.withReason > 0 ? <Breakdown summary={s} onPick={(category) => patch({ category })} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[260px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={term}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, reason, CSM…"
            aria-label="Search churned accounts"
            className={`${INPUT} w-full pl-8 pr-3`}
          />
        </div>
        <Select value={filters.region} onChange={(e) => patch({ region: e.target.value })} aria-label="Filter by region" className="w-[130px]">
          <option value="">All regions</option>
          {(s?.regions ?? []).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Select value={filters.category} onChange={(e) => patch({ category: e.target.value })} aria-label="Filter by churn category" className="w-[190px]">
          <option value="">Any reason</option>
          {(s?.categories ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={filters.csm} onChange={(e) => patch({ csm: e.target.value })} aria-label="Filter by CSM" className="w-[160px]">
          <option value="">Any CSM</option>
          {(s?.csms ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          value={filters.winbackStatus}
          onChange={(e) => patch({ winbackStatus: e.target.value as WinbackStatus | "" })}
          aria-label="Filter by win-back status"
          className="w-[160px]"
        >
          <option value="">Any win-back status</option>
          {WINBACK_STATUSES.map((w) => (
            <option key={w} value={w}>
              {WINBACK_LABEL[w]}
            </option>
          ))}
        </Select>
        <Select
          value={filters.mine ? "mine" : filters.ownerId}
          onChange={(e) => (e.target.value === "mine" ? patch({ mine: true, ownerId: "" }) : patch({ mine: false, ownerId: e.target.value }))}
          aria-label="Filter by win-back owner"
          className="w-[160px]"
        >
          <option value="">Any owner</option>
          <option value="mine">Mine</option>
          {(s?.owners ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="date" aria-label="Churned from" value={filters.churnedFrom} onChange={(e) => patch({ churnedFrom: e.target.value })} className={INPUT} />
          to
          <input type="date" aria-label="Churned to" value={filters.churnedTo} onChange={(e) => patch({ churnedTo: e.target.value })} className={INPUT} />
        </span>
        {hasActive && (
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
        )}
      </div>

      <div>
        <Card>
          <ChurnTable
            rows={rows}
            isPending={list.isPending}
            isError={list.isError}
            error={list.error}
            onRetry={() => list.refetch()}
            onSelect={(r) => setMerchantId(r.merchantId)}
            busy={list.isFetching && list.isPlaceholderData}
            filtered={hasActive}
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

      <ChurnDrawer merchantId={merchantId} owners={s?.owners ?? []} onClose={() => setMerchantId(null)} />
      <ChurnImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

/** Why accounts leave, and when: the two breakdowns the team asks for first. */
function Breakdown({ summary, onPick }: { summary: ChurnSummary; onPick: (category: string) => void }) {
  const cats = summary.byCategory.filter((c) => c.key !== "—").slice(0, 8);
  const max = Math.max(1, ...cats.map((c) => c.count));
  const months = summary.byMonth.slice(-12);
  const mmax = Math.max(1, ...months.map((m) => m.count));
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <p className="mb-3 text-xs font-semibold text-foreground">Why they leave</p>
        <ul className="flex flex-col gap-1.5">
          {cats.map((c) => (
            <li key={c.key}>
              <button type="button" onClick={() => onPick(c.key)} className="group flex w-full items-center gap-2 text-left" title={`Filter by ${c.key}`}>
                <span className="w-40 shrink-0 truncate text-table text-foreground group-hover:underline">{c.key}</span>
                <span className="h-2 flex-1 rounded-sm bg-muted">
                  <span className="block h-2 rounded-sm bg-primary" style={{ width: `${Math.round((c.count / max) * 100)}%` }} />
                </span>
                <span className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular">
                  {c.count} · {money(c.mrr, { compact: true })}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Count · MRR at churn. An account with two reasons counts under both.</p>
      </Card>
      <Card>
        <p className="mb-3 text-xs font-semibold text-foreground">By month</p>
        {months.length === 0 ? (
          <p className="text-table text-muted-foreground">No churn dates recorded yet.</p>
        ) : (
          <div className="flex h-28 items-end gap-1.5">
            {months.map((m) => (
              <div key={m.key} className="flex flex-1 flex-col items-center gap-1" title={`${monthLabel(m.key)}: ${m.count} churned, ${money(m.mrr)} MRR`}>
                <span className="text-[10px] text-muted-foreground tabular">{m.count}</span>
                <span className="w-full rounded-t-sm bg-primary/80" style={{ height: `${Math.max(4, Math.round((m.count / mmax) * 72))}px` }} />
                <span className="text-[10px] text-muted-foreground">{monthLabel(m.key).replace(" 20", " ’")}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
