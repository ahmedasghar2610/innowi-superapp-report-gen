"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Clock, FolderOpen, Info, LifeBuoy, Tags, X } from "lucide-react";
import { Card, ErrorState, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { useCaseInsights, useCases } from "../queries";
import type { CaseDepartmentSource, CaseFilters, CaseGroup, CaseInsights } from "../types";
import { FilterBar, FilterSelect, SearchBox, useDebounced, usePageFor } from "./list-controls";
import { SalesPageHeader, useSalesContext } from "./sales-shell";
import { CasesTable } from "./sales-tables";

/* ------------------------------------------------------------------ filters (in the URL) */

const FILTER_KEYS = ["state", "search", "from", "to", "department", "category", "source", "priority", "origin", "handledBy"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const LABEL: Record<FilterKey, string> = {
  state: "Cases",
  search: "Words",
  from: "From",
  to: "To",
  department: "Department",
  category: "Issue",
  source: "Department is",
  priority: "Priority",
  origin: "Came in by",
  handledBy: "Handled by",
};

const SOURCE_LABEL: Record<CaseDepartmentSource, string> = {
  recorded: "Recorded in Salesforce",
  estimated: "Estimated from the issue",
  unclassified: "Unclassified",
};

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

const PRESETS: { value: string; label: string; from?: () => string }[] = [
  { value: "all", label: "All time" },
  { value: "30", label: "Last 30 days", from: () => daysAgo(29) },
  { value: "90", label: "Last 90 days", from: () => daysAgo(89) },
  { value: "year", label: "This year", from: () => `${new Date().getFullYear()}-01-01` },
  { value: "custom", label: "Custom dates" },
];

/** Filters live in the URL, so a view can be shared, bookmarked and stepped back through. */
function useUrlFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = useMemo(() => {
    const f: CaseFilters = {};
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) (f as Record<string, string>)[k] = v;
    }
    return f;
  }, [params]);
  const set = useCallback(
    (patch: Partial<Record<FilterKey, string | undefined>>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return { filters, set };
}

/* ------------------------------------------------------------------ formatting */

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(n);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
function fmtHours(h: number | null | undefined) {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} days`;
}
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const monthDate = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1);

/* ------------------------------------------------------------------ page */

/**
 * /sales/cases/insights — which teams the support cases are for and what they're about.
 * Every chart is a filter: click a bar (or a cell of the matrix) to narrow everything,
 * including the case list at the bottom, which shows exactly the cases being counted.
 * Department = the team recorded in Salesforce, else an estimate from the issue category.
 */
export function CaseInsightsPage() {
  const { ownerQuery } = useSalesContext();
  const { filters, set } = useUrlFilters();
  const [search, setSearch] = useState(filters.search ?? "");
  const q = useDebounced(search.trim());
  // The search box writes to the URL too (debounced), so a shared link keeps it.
  useEffect(() => {
    if ((filters.search ?? "") !== q) set({ search: q || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  // ...and follows the URL when it changes underneath (back/forward, Clear all).
  useEffect(() => {
    setSearch((cur) => (cur.trim() === (filters.search ?? "") ? cur : (filters.search ?? "")));
  }, [filters.search]);
  const [preset, setPreset] = useState(filters.from || filters.to ? "custom" : "all");
  const [limit, setLimit] = useState(25);
  // Back to page 1 whenever whose cases, the filters or the search change.
  const [page, setPage] = usePageFor(JSON.stringify([ownerQuery.ownerId ?? "", filters, q, limit]));

  const query = { ...ownerQuery, ...filters, search: q || undefined, state: filters.state ?? "all" };
  const insights = useCaseInsights(query);
  const list = useCases({ ...query, page, limit });

  const toggle = (k: FilterKey, v: string) => set({ [k]: filters[k as keyof CaseFilters] === v ? undefined : v });
  const onPreset = (v: string) => {
    setPreset(v);
    const p = PRESETS.find((x) => x.value === v);
    if (v === "custom") return;
    set({ from: p?.from?.(), to: undefined });
  };
  const active = FILTER_KEYS.filter((k) => k !== "state" && filters[k as keyof CaseFilters]);
  const data = insights.data;

  return (
    <div className="flex flex-col gap-4">
      <SalesPageHeader
        title="Salesforce case analysis"
        description="Which teams the support tickets are for and what they're about. Click any bar to narrow everything below, including the list of cases."
      />

      <div>
        <FilterBar>
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
            }}
            placeholder="Search subjects or restaurants"
          />
          <FilterSelect
            label="Open or closed"
            value={filters.state ?? "all"}
            onChange={(v) => {
              set({ state: v === "all" ? undefined : v });
            }}
            options={[
              { value: "all", label: "All cases" },
              { value: "open", label: "Open cases" },
              { value: "closed", label: "Closed cases" },
            ]}
          />
          <FilterSelect label="Opened" value={preset} onChange={onPreset} options={PRESETS.map(({ value, label }) => ({ value, label }))} />
          {preset === "custom" && (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <input
                type="date"
                aria-label="From"
                value={filters.from ?? ""}
                onChange={(e) => set({ from: e.target.value || undefined })}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              />
              to
              <input
                type="date"
                aria-label="To"
                value={filters.to ?? ""}
                onChange={(e) => set({ to: e.target.value || undefined })}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              />
            </span>
          )}
          <FilterSelect
            label="Department is"
            value={filters.source ?? ""}
            onChange={(v) => {
              set({ source: v || undefined });
            }}
            options={[
              { value: "", label: "Any department" },
              { value: "recorded", label: "Recorded only" },
              { value: "estimated", label: "Estimated only" },
              { value: "unclassified", label: "Unclassified only" },
            ]}
          />
        </FilterBar>
        {active.length > 0 && (
          <div className="mb-1 flex flex-wrap items-center gap-1.5" data-testid="active-filters">
            {active.map((k) => {
              const raw = filters[k as keyof CaseFilters] as string;
              const shown =
                k === "source"
                  ? SOURCE_LABEL[raw as CaseDepartmentSource] ?? raw
                  : k === "handledBy"
                    ? (data?.byHandler.find((h) => h.id === raw)?.key ?? "selected person")
                    : raw;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    if (k === "search") setSearch("");
                    if ((k === "from" || k === "to") && !(filters.from && filters.to)) setPreset("all");
                    set({ [k]: undefined });
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-primary-border bg-primary-subtle px-2.5 py-1 text-xs font-medium text-primary hover:opacity-90"
                  aria-label={`Remove filter ${LABEL[k]}: ${shown}`}
                >
                  {LABEL[k]}: {shown} <X className="size-3" aria-hidden />
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setPreset("all");
                setSearch("");
                set(Object.fromEntries(active.map((k) => [k, undefined])));
              }}
              className="px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {insights.isError ? (
        <Card>
          <ErrorState error={insights.error} onRetry={() => insights.refetch()} />
        </Card>
      ) : !data ? (
        <LoadingGrid />
      ) : (
        <div className={cn("flex flex-col gap-4", insights.isFetching && insights.isPlaceholderData && "opacity-70 transition-opacity")}>
          {data.totals.cases > 0 && data.totals.categorised === 0 && (
            <div role="status" className="flex items-start gap-2 rounded-[var(--radius-xl)] border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                None of these cases has an issue category yet. The categories are still being copied from Salesforce; check
                back after the next sync (it runs every 15 minutes).
              </span>
            </div>
          )}
          <Totals data={data} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              title="By department"
              note="Recorded team when Salesforce has one, otherwise estimated from the issue."
              icon={FolderOpen}
            >
              <BarList items={data.byDepartment} selected={filters.department} onSelect={(k) => toggle("department", k)} total={data.totals.cases} />
            </Panel>
            <Panel title="By kind of issue" note="Salesforce's Issue Category." icon={Tags}>
              <BarList
                items={data.byCategory}
                selected={filters.category}
                onSelect={(k) => toggle("category", k)}
                total={data.totals.cases}
                sub={(g) => ("department" in g ? `usually → ${(g as CaseGroup & { department: string }).department}` : undefined)}
              />
            </Panel>
          </div>
          <Matrix data={data} filters={filters} onPick={(d, c) => {
            const same = filters.department === d && filters.category === c;
            set({ department: same ? undefined : d, category: same ? undefined : c });
          }} />
          <Trend data={data} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Handled by" icon={LifeBuoy}>
              <BarList
                items={data.byHandler}
                idOf={(g) => (g as CaseGroup & { id: string }).id}
                selected={filters.handledBy}
                onSelect={(id) => toggle("handledBy", id)}
                total={data.totals.cases}
                compact
              />
            </Panel>
            <Panel title="Came in by">
              <BarList items={data.byOrigin} selected={filters.origin} onSelect={(k) => toggle("origin", k)} total={data.totals.cases} compact />
            </Panel>
            <Panel title="Priority">
              <BarList items={data.byPriority} selected={filters.priority} onSelect={(k) => toggle("priority", k)} total={data.totals.cases} compact />
            </Panel>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Restaurants with the most cases">
              <ul className="flex flex-col gap-1.5 text-sm">
                {data.topRestaurants.length === 0 && <li className="text-muted-foreground">None</li>}
                {data.topRestaurants.map((r) => (
                  <li key={r.id} className="flex items-center gap-3">
                    <Link href={`/sales/customers/${r.id}`} className="min-w-0 flex-1 truncate text-foreground hover:underline">
                      {r.key}
                    </Link>
                    <span className="tabular text-muted-foreground">{r.open ? `${fmt(r.open)} open · ` : ""}</span>
                    <span className="w-10 text-right font-semibold tabular text-foreground">{fmt(r.count)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Common words in subjects" note="From the subjects of up to 8,000 of the newest cases here. Click one to search for it; handy for the Other and Unclassified cases.">
              <div className="flex flex-wrap gap-1.5">
                {data.subjectWords.length === 0 && <span className="text-sm text-muted-foreground">None</span>}
                {data.subjectWords.map((w) => (
                  <button
                    key={w.key}
                    type="button"
                    onClick={() => {
                      setSearch(w.key);
                    }}
                    className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-foreground hover:border-primary-border hover:bg-primary-subtle"
                  >
                    {w.key} <span className="tabular text-muted-foreground">{fmt(w.count)}</span>
                  </button>
                ))}
              </div>
            </Panel>
          </div>
          <MappingNote data={data} />
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between px-4 pt-4">
          <div className="text-sm font-semibold text-foreground">
            The cases{list.data ? ` (${fmt(list.data.meta.total)})` : ""}
          </div>
          <span className="text-xs text-muted-foreground">Exactly the cases counted above</span>
        </div>
        <CasesTable
          cases={list.data?.data ?? []}
          isPending={list.isPending}
          isError={list.isError}
          error={list.error}
          onRetry={() => list.refetch()}
          busy={list.isFetching && list.isPlaceholderData}
          emptyTitle="No cases match"
          showIssue
        />
      </Card>
      {list.data && list.data.meta.total > 0 && (
        <MerchantPagination
          meta={list.data.meta}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setLimit(n);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function LoadingGrid() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

function Panel({
  title,
  note,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  note?: string;
  icon?: typeof Info;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="mb-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
          {title}
        </div>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </Card>
  );
}

function Totals({ data }: { data: CaseInsights }) {
  const t = data.totals;
  const tiles = [
    { label: "Cases", value: fmt(t.cases), sub: t.firstCreated ? `since ${MONTH_YEAR.format(new Date(t.firstCreated))}` : undefined },
    { label: "Still open", value: fmt(t.open), sub: pct(t.open, t.cases) + " of these" },
    { label: "Typical time to close", value: fmtHours(t.medianHoursToClose), sub: "median of the closed ones, calendar time", icon: Clock },
    {
      label: "Department",
      value: pct(t.departmentRecorded, t.cases) + " recorded",
      sub: `${pct(t.departmentEstimated, t.cases)} estimated · ${pct(t.departmentUnclassified, t.cases)} unclassified`,
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="case-totals">
      {tiles.map((x) => (
        <Card key={x.label} className="p-4">
          <div className="text-xs font-medium text-muted-foreground">{x.label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-foreground tabular">{x.value}</div>
          {x.sub && <div className="mt-0.5 text-xs text-muted-foreground">{x.sub}</div>}
        </Card>
      ))}
    </div>
  );
}

/** Horizontal bars: one measure (case count), one hue, value written on every row. Each row is a filter. */
function BarList({
  items,
  selected,
  onSelect,
  total,
  sub,
  compact,
  idOf = (g) => g.key,
}: {
  items: CaseGroup[];
  /** What selecting a row filters by (and what `selected` holds); the label by default. */
  idOf?: (g: CaseGroup) => string;
  selected?: string;
  onSelect: (id: string) => void;
  total: number;
  sub?: (g: CaseGroup) => string | undefined;
  compact?: boolean;
}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const shown = compact ? items.slice(0, 8) : items;
  if (!items.length) return <p className="text-sm text-muted-foreground">No cases</p>;
  return (
    <ul className="flex flex-col gap-1">
      {shown.map((g) => {
        const id = idOf(g);
        const on = selected === id;
        const dim = selected !== undefined && !on;
        const extra = sub?.(g);
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => onSelect(id)}
              aria-pressed={on}
              title={`${g.key}: ${fmt(g.count)} cases (${pct(g.count, total)}), ${fmt(g.open)} open, typical close ${fmtHours(g.medianHoursToClose)}`}
              className={cn(
                "group grid w-full grid-cols-[minmax(0,13rem)_1fr_auto] items-center gap-3 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-muted/60",
                on && "bg-primary-subtle",
                compact && "grid-cols-[minmax(0,8rem)_1fr_auto]",
              )}
            >
              <span className={cn("min-w-0 truncate", dim ? "text-muted-foreground" : "text-foreground")}>
                {g.key}
                {extra && <span className="block truncate text-[11px] text-muted-foreground">{extra}</span>}
              </span>
              <span className="relative h-2.5 rounded-full bg-muted" aria-hidden>
                <span
                  className={cn("sa-grow-x absolute inset-y-0 left-0 rounded-full", dim ? "bg-[var(--chart-5)]" : "bg-[var(--chart-1)]")}
                  style={{ width: `${Math.max(2, (g.count / max) * 100)}%` }}
                />
              </span>
              <span className="w-[4.5rem] text-right tabular">
                <span className="font-semibold text-foreground">{fmt(g.count)}</span>
                <span className="ml-1 text-[11px] text-muted-foreground">{pct(g.count, total)}</span>
              </span>
            </button>
          </li>
        );
      })}
      {compact && items.length > shown.length && (
        <li className="px-1.5 pt-1 text-xs text-muted-foreground">+ {items.length - shown.length} more</li>
      )}
    </ul>
  );
}

/** Department × issue: one hue, darker = more cases. Click a cell to look at just those cases. */
function Matrix({ data, filters, onPick }: { data: CaseInsights; filters: CaseFilters; onPick: (d: string, c: string) => void }) {
  const depts = data.byDepartment.map((d) => d.key);
  const cats = data.byCategory.map((c) => c.key);
  const cell = new Map(data.matrix.map((x) => [`${x.department}\u0000${x.category}`, x.count]));
  const max = Math.max(1, ...data.matrix.map((x) => x.count));
  if (!depts.length) return null;
  return (
    <Card className="p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-foreground">Department × kind of issue</div>
        <p className="mt-0.5 text-xs text-muted-foreground">Darker = more cases. Click a square to see those cases.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-xs" data-testid="case-matrix">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card" />
              {cats.map((c) => (
                <th key={c} scope="col" className="relative h-28 w-9 min-w-9 max-w-9 p-0 font-medium text-muted-foreground">
                  {/* Out of the flow, so a long name doesn't widen its column. */}
                  <span className="absolute bottom-2 left-1/2 origin-bottom-left -rotate-45 whitespace-nowrap" title={c}>
                    {c}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {depts.map((d) => (
              <tr key={d}>
                <th scope="row" className="sticky left-0 z-10 max-w-[11rem] truncate bg-card pr-2 text-left font-medium text-foreground">
                  {d}
                </th>
                {cats.map((c) => {
                  const n = cell.get(`${d}\u0000${c}`) ?? 0;
                  const on = filters.department === d && filters.category === c;
                  const strength = n ? 0.12 + 0.88 * (n / max) : 0;
                  return (
                    <td key={c} className="p-0">
                      <button
                        type="button"
                        disabled={!n}
                        aria-pressed={on}
                        onClick={() => onPick(d, c)}
                        title={`${d} · ${c}: ${fmt(n)} cases`}
                        aria-label={`${d}, ${c}: ${n} cases`}
                        className={cn(
                          "grid size-9 place-items-center rounded-[4px] tabular transition-shadow",
                          n ? "hover:ring-2 hover:ring-primary" : "cursor-default bg-muted/40",
                          on && "ring-2 ring-foreground",
                        )}
                        style={n ? { backgroundColor: `color-mix(in oklab, var(--chart-1) ${Math.round(strength * 100)}%, transparent)` } : undefined}
                      >
                        {n ? <span className={cn(strength > 0.55 ? "text-white" : "text-foreground")}>{n}</span> : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Cases opened per month (the filtered set). One series, so no legend. */
function Trend({ data }: { data: CaseInsights }) {
  const months = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of data.byMonth) by.set(r.month, (by.get(r.month) ?? 0) + r.count);
    const keys = [...by.keys()].sort();
    if (!keys.length) return [];
    // Every month from the first to the last, so a quiet month shows as a gap, not as missing.
    const out: { month: string; count: number }[] = [];
    const d = monthDate(keys[0]);
    const end = monthDate(keys[keys.length - 1]);
    while (d <= end) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      out.push({ month: k, count: by.get(k) ?? 0 });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [data.byMonth]);
  const [hover, setHover] = useState<number | null>(null);
  if (months.length < 2) return null;
  const W = 720;
  const H = 180;
  const pad = { l: 8, r: 8, t: 16, b: 24 };
  const max = Math.max(1, ...months.map((m) => m.count));
  const bw = (W - pad.l - pad.r) / months.length;
  const barW = Math.max(4, Math.min(36, bw - 2));
  const peak = months.reduce((a, b) => (b.count > a.count ? b : a));
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-sm font-semibold text-foreground">Cases opened per month</div>
        <div className="text-xs text-muted-foreground tabular">
          {hover != null
            ? `${MONTH_YEAR.format(monthDate(months[hover].month))}: ${fmt(months[hover].count)}`
            : `Busiest: ${MONTH_YEAR.format(monthDate(peak.month))} (${fmt(peak.count)})`}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full" role="img" aria-label="Cases opened per month">
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="stroke-border" />
        {months.map((m, i) => {
          const h = ((H - pad.t - pad.b) * m.count) / max;
          const x = pad.l + i * bw + (bw - barW) / 2;
          const y = H - pad.b - h;
          return (
            <g key={m.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {m.count > 0 && (
                <rect x={x} y={y} width={barW} height={Math.max(h, 1)} rx={4} fill={hover === i ? "var(--chart-4)" : "var(--chart-1)"} />
              )}
              {(months.length <= 14 || i % Math.ceil(months.length / 12) === 0) && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {MONTH.format(monthDate(m.month))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Card>
  );
}

function MappingNote({ data }: { data: CaseInsights }) {
  const byDept = new Map<string, string[]>();
  for (const m of data.mapping) byDept.set(m.department, [...(byDept.get(m.department) ?? []), m.category]);
  return (
    <details className="rounded-[var(--radius-xl)] border border-border bg-card px-4 py-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground">
        <Info className="size-4 text-muted-foreground" aria-hidden /> How the department is worked out
      </summary>
      <div className="mt-2 space-y-2 text-muted-foreground">
        <p>
          Salesforce has a &ldquo;Case Assigned To&rdquo; team field, but it&apos;s filled on only{" "}
          {pct(data.totals.departmentRecorded, data.totals.cases)} of these cases. When it&apos;s filled, that team is used
          (&ldquo;recorded&rdquo;). Otherwise the team is estimated from the issue category, the way recorded cases are usually
          routed. Cases with no category, or &ldquo;Other&rdquo;, are &ldquo;Unclassified&rdquo;.
        </p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {[...byDept.entries()].map(([d, cs]) => (
            <li key={d}>
              <span className="font-medium text-foreground">{d}:</span> {cs.join(", ")}
            </li>
          ))}
        </ul>
        <p>Asking the care team to fill in &ldquo;Case Assigned To&rdquo; would turn these estimates into recorded numbers.</p>
      </div>
    </details>
  );
}
