"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { useCases, useCustomers, useDeals, useVisits, useVisitTypes } from "../queries";
import { FilterBar, FilterSelect, SearchBox, useDebounced, usePageFor } from "./list-controls";
import { SalesPageHeader, useSalesContext } from "./sales-shell";
import { CasesTable, CustomersTable, DealsTable, VisitsTable } from "./sales-tables";
import type { CaseQuery, DealQuery, VisitQuery } from "../types";

/* ------------------------------------------------------------------ deals */

const GROUP_LABELS: Record<string, string> = {
  won: "Won",
  follow_up: "Follow up later",
  lost: "Lost",
  in_deployment: "In deployment",
  other_open: "Other open",
};

function columnLabel(key: string): string {
  return key.startsWith("stage:") ? key.slice("stage:".length) : (GROUP_LABELS[key] ?? key);
}

type DealState = NonNullable<DealQuery["state"]>;

type Quiet = NonNullable<DealQuery["quiet"]>;
const QUIET_LABELS: Record<Quiet, string> = {
  stuck: "No change in 30+ days",
  stale: "Stale (no change in 6+ months)",
};

export interface DealsPageProps {
  initialColumn?: string;
  initialState?: DealState;
  initialStale?: boolean;
  initialQuiet?: Quiet;
}

/** /sales/deals — every deal the person may see, newest change first. */
export function DealsPage({ initialColumn, initialState = "open", initialStale = false, initialQuiet }: DealsPageProps) {
  const { me, ownerQuery } = useSalesContext();
  const [page, setPage] = usePageFor(ownerQuery.ownerId ?? "");
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<DealState>(initialState);
  const [column, setColumn] = useState(initialColumn ?? "");
  const [includeStale, setIncludeStale] = useState(initialStale);
  const [quiet, setQuiet] = useState<Quiet | "">(initialQuiet ?? "");
  const q = useDebounced(search.trim());

  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = useDeals({
    ...ownerQuery,
    page,
    limit,
    search: q || undefined,
    state,
    column: column || undefined,
    includeStale,
    quiet: quiet || undefined,
  });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <div>
      <SalesPageHeader title="Salesforce deals" description="Opportunities copied from Salesforce, most recently changed first. The Super App's own deals are under Sales → Deals." />
      <FilterBar>
        <SearchBox value={search} onChange={reset(setSearch)} placeholder="Search deal or restaurant" />
        <FilterSelect<DealState>
          label="Open or closed"
          value={state}
          onChange={reset(setState)}
          options={[
            { value: "open", label: "Open deals" },
            { value: "closed", label: "Closed deals" },
            { value: "all", label: "All deals" },
          ]}
        />
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 cursor-pointer rounded border-border accent-primary"
            checked={includeStale}
            onChange={(e) => reset(setIncludeStale)(e.target.checked)}
          />
          Include stale (6+ months, still open)
        </label>
        {quiet && (
          <Badge tone="warning" icon={false} className="gap-1">
            {QUIET_LABELS[quiet]}
            <button type="button" aria-label="Clear this filter" onClick={() => reset(setQuiet)("")} className="-mr-1 rounded hover:bg-card">
              <X className="size-3.5" />
            </button>
          </Badge>
        )}
        {column && (
          <Badge tone="accent" icon={false} className="gap-1">
            {columnLabel(column)}
            <button type="button" aria-label="Clear stage filter" onClick={() => reset(setColumn)("")} className="-mr-1 rounded hover:bg-card">
              <X className="size-3.5" />
            </button>
          </Badge>
        )}
      </FilterBar>
      <DealsTable
        deals={data?.data ?? []}
        isPending={isPending}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        busy={isFetching && isPlaceholderData}
        showOwner={me.seeAll && !ownerQuery.ownerId}
        emptyTitle="No deals match"
        emptyDescription="Try another filter, or include stale deals."
      />
      {data && data.meta.total > 0 && (
        <MerchantPagination meta={data.meta} onPageChange={setPage} onPageSizeChange={reset(setLimit)} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------- customers */

/** /sales/customers — restaurants (Salesforce Accounts) linked to the person's deals, visits or check-ins. */
export function CustomersPage() {
  const { ownerQuery } = useSalesContext();
  const [page, setPage] = usePageFor(ownerQuery.ownerId ?? "");
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [health, setHealth] = useState("");
  const [onlyCustomers, setOnlyCustomers] = useState(false);
  const q = useDebounced(search.trim());

  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = useCustomers({
    ...ownerQuery,
    page,
    limit,
    search: q || undefined,
    health: health || undefined,
    onlyCustomers,
  });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <div>
      <SalesPageHeader
        title="Salesforce accounts"
        description="Salesforce accounts tied to these deals, visits and check-ins. Health comes from the latest Touchpoint. Not linked to the Super App's Merchants yet."
      />
      <FilterBar>
        <SearchBox value={search} onChange={reset(setSearch)} placeholder="Search restaurant name" />
        <FilterSelect
          label="Health"
          value={health}
          onChange={reset(setHealth)}
          options={[
            { value: "", label: "Any health" },
            // The Health_Status__c values actually present in Innowi's org (checked Oct 2026).
            { value: "Green", label: "Green" },
            { value: "Yellow", label: "Yellow" },
            { value: "Orange", label: "Orange" },
            { value: "Red", label: "Red" },
            { value: "Newly Deployed", label: "Newly Deployed" },
            { value: "Not Live", label: "Not Live" },
            { value: "N/A", label: "N/A" },
          ]}
          className="w-44"
        />
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 cursor-pointer rounded border-border accent-primary"
            checked={onlyCustomers}
            onChange={(e) => reset(setOnlyCustomers)(e.target.checked)}
          />
          Only signed customers (a won deal)
        </label>
      </FilterBar>
      <CustomersTable
        customers={data?.data ?? []}
        isPending={isPending}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        busy={isFetching && isPlaceholderData}
        emptyTitle="No restaurants match"
      />
      {data && data.meta.total > 0 && (
        <MerchantPagination meta={data.meta} onPageChange={setPage} onPageSizeChange={reset(setLimit)} />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- visits */

type VisitState = NonNullable<VisitQuery["state"]>;
type VisitWhen = NonNullable<VisitQuery["when"]>;

/** /sales/visits — Innowi Tasks (site visits, installs, trainings) assigned to the person. */
export function VisitsPage({ initialWhen = "all" }: { initialWhen?: VisitWhen }) {
  const { me, ownerQuery } = useSalesContext();
  const [page, setPage] = usePageFor(ownerQuery.ownerId ?? "");
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<VisitState>("open");
  const [when, setWhen] = useState<VisitWhen>(initialWhen);
  const [type, setType] = useState("");
  const q = useDebounced(search.trim());
  const types = useVisitTypes();

  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = useVisits({
    ...ownerQuery,
    page,
    limit,
    search: q || undefined,
    state,
    when,
    type: type || undefined,
  });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <div>
      <SalesPageHeader
        title="Visits"
        description="Site visits, installs and trainings (Innowi Tasks in Salesforce), soonest first."
      />
      <FilterBar>
        <SearchBox value={search} onChange={reset(setSearch)} placeholder="Search restaurant or visit name" />
        <FilterSelect<VisitWhen>
          label="When"
          value={when}
          onChange={reset(setWhen)}
          options={[
            { value: "all", label: "Any date" },
            { value: "overdue", label: "Overdue" },
            { value: "today", label: "Today" },
            { value: "week", label: "Today + next 7 days" },
            { value: "next7", label: "Next 7 days (not today)" },
            { value: "upcoming", label: "Upcoming" },
          ]}
          className="w-36"
        />
        <FilterSelect<VisitState>
          label="Status"
          value={state}
          onChange={reset(setState)}
          options={[
            { value: "open", label: "Still to do" },
            { value: "done", label: "Done or cancelled" },
            { value: "all", label: "All" },
          ]}
          className="w-40"
        />
        <FilterSelect
          label="Visit type"
          value={type}
          onChange={reset(setType)}
          options={[{ value: "", label: "Any type" }, ...(types.data ?? []).map((t) => ({ value: t, label: t }))]}
        />
      </FilterBar>
      <VisitsTable
        visits={data?.data ?? []}
        isPending={isPending}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        busy={isFetching && isPlaceholderData}
        showOwner={me.seeAll && !ownerQuery.ownerId}
        emptyTitle="No visits match"
      />
      {data && data.meta.total > 0 && (
        <MerchantPagination meta={data.meta} onPageChange={setPage} onPageSizeChange={reset(setLimit)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ cases */

type CaseState = NonNullable<CaseQuery["state"]>;

/** /sales/cases — support cases on the person's restaurants (read-only; support works them in Salesforce). */
export function CasesPage() {
  const { ownerQuery } = useSalesContext();
  const [page, setPage] = usePageFor(ownerQuery.ownerId ?? "");
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<CaseState>("open");
  const q = useDebounced(search.trim());

  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = useCases({
    ...ownerQuery,
    page,
    limit,
    search: q || undefined,
    state,
  });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <div>
      <SalesPageHeader
        title="Salesforce cases"
        description="Support cases on these restaurants, so you know before you walk in. Support handles them in Salesforce."
      />
      <FilterBar>
        <SearchBox value={search} onChange={reset(setSearch)} placeholder="Search case number, subject or restaurant" />
        <FilterSelect<CaseState>
          label="Open or closed"
          value={state}
          onChange={reset(setState)}
          options={[
            { value: "open", label: "Open cases" },
            { value: "closed", label: "Closed cases" },
            { value: "all", label: "All cases" },
          ]}
        />
      </FilterBar>
      <CasesTable
        cases={data?.data ?? []}
        isPending={isPending}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        busy={isFetching && isPlaceholderData}
        emptyTitle="No cases match"
      />
      {data && data.meta.total > 0 && (
        <MerchantPagination meta={data.meta} onPageChange={setPage} onPageSizeChange={reset(setLimit)} />
      )}
    </div>
  );
}
