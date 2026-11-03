"use client";

import { useId, useMemo, useState } from "react";
import { FlaskConical, Info, Search as SearchIcon } from "lucide-react";
import {
  Button,
  Card,
  ErrorState,
  Input,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useApprove, useGenerate, useQueue, useReportGenStatus } from "../api";
import type { QueueRow as Row } from "../types";
import { QueueSummary } from "./queue-summary";
import { QueueLine, TOTAL_METRICS, needsAction, rowStatus } from "./queue-row";
import { ACTION_ORDER, CHIP_ORDER, STATUS_META, type RowStatus } from "./report-status";

// The review sidebar asks this module for a status description.
export { STATUS, StatusBadge } from "./report-status";

type SortKey = "action" | "name" | "completeness";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "action", label: "Needs action first" },
  { value: "name", label: "Name A–Z" },
  { value: "completeness", label: "Data completeness" },
];

/** The last twelve ended months as YYYY-MM options, newest first. */
function monthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 1; i <= 12; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({
      value: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`,
      label: m.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

/** /report-gen — the command table: one row per active merchant for the month. */
export function QueuePage() {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0].value);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "action" | RowStatus>("all");
  const [sort, setSort] = useState<SortKey>("action");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const status = useReportGenStatus();
  const q = useQueue(month);
  const d = q.data;
  const canManage = !!status.data?.canManage;
  const canApprove = !!status.data?.canApprove;

  const rows = useMemo(() => d?.merchants ?? [], [d]);
  const counts = useMemo(() => {
    const c = Object.fromEntries((Object.keys(STATUS_META) as RowStatus[]).map((k) => [k, 0])) as Record<RowStatus, number>;
    for (const r of rows) c[rowStatus(r)] = (c[rowStatus(r)] ?? 0) + 1;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let out = rows.filter((r) => (needle ? r.merchant.name.toLowerCase().includes(needle) : true));
    if (filter === "action") out = out.filter(needsAction);
    else if (filter !== "all") out = out.filter((r) => rowStatus(r) === filter);

    const completeness = (r: Row) => (r.report ? (TOTAL_METRICS - r.report.missingCount) / TOTAL_METRICS : -1);
    const byName = (a: Row, b: Row) => a.merchant.name.localeCompare(b.merchant.name);
    return [...out].sort((a, b) => {
      if (sort === "name") return byName(a, b);
      if (sort === "completeness") return completeness(b) - completeness(a) || byName(a, b);
      return ACTION_ORDER.indexOf(rowStatus(a)) - ACTION_ORDER.indexOf(rowStatus(b)) || byName(a, b);
    });
  }, [rows, query, filter, sort]);

  if (q.error) return <ErrorState title="Couldn't load the report queue" description={q.error.message} />;
  if (!d) return <Skeleton className="h-96 w-full" />;

  const monthLabel = months.find((m) => m.value === month)?.label ?? d.period.label;
  const approvedRow = rows.filter((r) => rowStatus(r) === "approved");

  const toggle = (id: string, next: boolean) =>
    setPicked((prev) => {
      const s = new Set(prev);
      if (next) s.add(id);
      else s.delete(id);
      return s;
    });

  return (
    <div className="flex flex-col gap-6">
      <Header month={month} months={months} onMonth={setMonth} />

      <QueueSummary
        counts={counts}
        total={rows.length}
        monthLabel={monthLabel}
        approvedName={approvedRow.length === 1 ? approvedRow[0].merchant.name : null}
        onNeedsAction={() => { setFilter("action"); setQuery(""); }}
      />

      <Toolbar
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        counts={counts}
        total={rows.length}
        actionCount={rows.filter(needsAction).length}
        sort={sort}
        onSort={setSort}
      />

      <Card className="rounded-xl p-0 shadow-sm">
        <BulkBar rows={rows} picked={picked} onClear={() => setPicked(new Set())} month={month} canApprove={canApprove} canManage={canManage} />

        {rows.length === 0 ? (
          <EmptyMonth monthLabel={monthLabel} />
        ) : shown.length === 0 ? (
          <NoMatches onClear={() => { setQuery(""); setFilter("all"); }} />
        ) : (
          <>
            {/*
             * The table is laid out `fixed` at percentage column widths so it
             * always fits the card: no column can be widened by its content.
             * `overflow-x-clip` rather than `-hidden` because `clip` is not a
             * scroll container — a scroll container would both re-anchor the
             * sticky header to this box and force overflow-y to `auto`. The
             * primitive hard-codes the <table> class, so `table-fixed` and the
             * below-md block mode reach it as child selectors instead of props.
             */}
            <Table
              className={cn(
                "overflow-x-clip rounded-none border-0",
                "[&>table]:table-fixed max-md:[&>table]:block",
              )}
            >
              <TableHeader className="sticky top-0 z-10 bg-card max-md:hidden">
                <TableRow>
                  {/* No `relative` here: the primitive's `sticky` is already a
                      positioned ancestor for the absolute `sr-only` span, and
                      `relative` would replace it and break the sticky header. */}
                  <TableHead className="md:w-[4%]">
                    <span className="sr-only">Select</span>
                  </TableHead>
                  {/* Headers wrap rather than force a column wider than its share. */}
                  <TableHead className="whitespace-normal md:w-[48%] lg:w-[37%] xl:w-[24%]">Merchant</TableHead>
                  <TableHead className="whitespace-normal md:w-[20%] xl:w-[15%]">Status</TableHead>
                  <TableHead className="hidden whitespace-normal lg:table-cell lg:w-[17%]">Data completeness</TableHead>
                  <TableHead className="hidden whitespace-normal xl:table-cell xl:w-[20%]">Services &amp; linked data</TableHead>
                  <TableHead align="right" className="whitespace-normal md:w-[28%] lg:w-[22%] xl:w-[20%]">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="max-md:block">
                {shown.map((row) => (
                  <QueueLine
                    key={row.merchant.id}
                    row={row}
                    month={month}
                    canManage={canManage}
                    canApprove={canApprove}
                    selected={picked.has(row.merchant.id)}
                    onSelect={toggle}
                  />
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <span>
                Showing <span className="tabular-nums">{shown.length}</span> of <span className="tabular-nums">{rows.length}</span> merchants
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-primary" aria-hidden /> needs your action
              </span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- header ---- */
function Header({ month, months, onMonth }: { month: string; months: { value: string; label: string }[]; onMonth: (v: string) => void }) {
  const [tip, setTip] = useState(false);
  const tipId = useId();
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">Merchant Reports</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Generate, review and approve each merchant&apos;s monthly report. Nothing is sent until a manager approves it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <button
            type="button"
            aria-describedby={tip ? tipId : undefined}
            onMouseEnter={() => setTip(true)}
            onMouseLeave={() => setTip(false)}
            onFocus={() => setTip(true)}
            onBlur={() => setTip(false)}
            onKeyDown={(e) => e.key === "Escape" && setTip(false)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-warning-soft px-3 text-xs font-medium text-warning-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <FlaskConical className="size-3.5" aria-hidden />
            Test mode · no e-mails are sent
            <Info className="size-3.5" aria-hidden />
          </button>
          {tip && (
            <div
              role="tooltip"
              id={tipId}
              className="absolute right-0 top-[calc(100%+6px)] z-40 w-72 rounded-lg border border-border bg-card p-3 text-left shadow-lg"
            >
              <p className="text-sm font-semibold text-foreground">You&apos;re in test mode</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Approve and send work exactly as normal, but no e-mail leaves Innowi. An admin can switch on live sending.
              </p>
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="sr-only sm:not-sr-only">Month</span>
          <Select value={month} onChange={(e) => onMonth(e.target.value)} className="min-h-10 w-44">
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- toolbar ---- */
function Toolbar({
  query,
  onQuery,
  filter,
  onFilter,
  counts,
  total,
  actionCount,
  sort,
  onSort,
}: {
  query: string;
  onQuery: (v: string) => void;
  filter: "all" | "action" | RowStatus;
  onFilter: (v: "all" | "action" | RowStatus) => void;
  counts: Record<RowStatus, number>;
  total: number;
  actionCount: number;
  sort: SortKey;
  onSort: (v: SortKey) => void;
}) {
  const chips: { key: "all" | "action" | RowStatus; label: string; count: number }[] = [
    { key: "all", label: "All", count: total },
    { key: "action", label: "Needs action", count: actionCount },
    ...CHIP_ORDER.filter((k) => (counts[k] ?? 0) > 0).map((k) => ({ key: k, label: STATUS_META[k].label, count: counts[k] })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search merchants"
          aria-label="Search merchants"
          className="min-h-10 pl-9"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => {
          const on = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => onFilter(c.key)}
              className={cn(
                "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                on ? "border-primary bg-accent text-primary-subtle-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {c.label}
              <span className={cn("tabular-nums", on ? "text-primary-subtle-foreground" : "text-muted-foreground")}>{c.count}</span>
            </button>
          );
        })}
      </div>
      <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span className="sr-only sm:not-sr-only">Sort</span>
        <Select value={sort} onChange={(e) => onSort(e.target.value as SortKey)} className="min-h-10 w-48" aria-label="Sort merchants">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}

/* ------------------------------------------------------------ bulk bar ---- */
/** Bulk actions loop over the same single-row handlers. */
function BulkBar({
  rows,
  picked,
  onClear,
  month,
  canApprove,
  canManage,
}: {
  rows: Row[];
  picked: Set<string>;
  onClear: () => void;
  month: string;
  canApprove: boolean;
  canManage: boolean;
}) {
  const approve = useApprove();
  const gen = useGenerate();
  const { toast } = useToast();
  if (picked.size === 0) return null;

  const chosen = rows.filter((r) => picked.has(r.merchant.id));
  const approvable = chosen.filter((r) => ["draft", "edited"].includes(rowStatus(r)));
  const missing = chosen.filter((r) => rowStatus(r) === "due");

  return (
    <div data-testid="queue-bulk-bar" className="flex flex-wrap items-center gap-3 border-b border-border bg-accent/50 px-4 py-2.5">
      <span className="text-sm font-medium text-foreground">
        <span className="tabular-nums">{picked.size}</span> selected
      </span>
      <Button
        size="sm"
        variant="default"
        disabled={!canApprove || approvable.length === 0}
        loading={approve.isPending}
        onClick={() => {
          approvable.forEach((r) => r.report && approve.mutate(r.report.id));
          toast({ variant: "success", title: `Approving ${approvable.length} report${approvable.length === 1 ? "" : "s"}` });
        }}
      >
        Approve selected
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!canManage || missing.length === 0}
        loading={gen.isPending}
        onClick={() => {
          missing.forEach((r) => gen.mutate({ merchantId: r.merchant.id, month }));
          toast({ variant: "success", title: `Generating ${missing.length} report${missing.length === 1 ? "" : "s"}` });
        }}
      >
        Generate missing ({missing.length})
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}

/* -------------------------------------------------------- empty states ---- */
function EmptyMonth({ monthLabel }: { monthLabel: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-foreground">No active merchants in {monthLabel}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        When a merchant becomes active for this month it appears here, ready to generate.
      </p>
    </div>
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-foreground">No merchants match</p>
      <Button size="sm" variant="outline" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}
