"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Printer, Search, Star, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Skeleton,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
  useToast,
  type SortDirection,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useGbpOverview, useGbpStatus, useSampleData } from "../api";
import { changeText, downloadCsv, fmtNum, OPEN_STATUS, rangeToParams, VERIFICATION } from "../lib";
import type { Overview, OverviewRow } from "../types";
import { ConnectionPanel } from "./connection-panel";
import { ChangeLine, NoData, RangeCaption, RangePicker, Section, StatusBadges, useRangeParam } from "./parts";

export function GbpPage() {
  const status = useGbpStatus();
  const through = status.data?.dataThrough ?? null;
  const range = useRangeParam(through);
  const overview = useGbpOverview(range.dates);
  const o = overview.data;
  const rangeQs = new URLSearchParams(rangeToParams(range.state)).toString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Google Business Profile</h1>
          <p className="mt-1 text-table text-muted-foreground">
            How every restaurant listing performs on Google Search and Maps — calls, website clicks, directions, reviews and posts. Read-only: nothing here changes a listing on Google.
          </p>
        </div>
      </div>

      {status.data ? <ConnectionPanel status={status.data} /> : <Skeleton className="h-14 w-full" />}

      <div className="flex flex-wrap items-center gap-3">
        <RangePicker state={range.state} through={through} onChange={(r) => range.set(r)} />
        {o && <RangeCaption start={o.range.start} end={o.range.end} prevStart={o.previous.start} prevEnd={o.previous.end} through={o.dataThrough} />}
        <div className="ml-auto flex gap-2 print:hidden">
          <Button size="sm" variant="outline" disabled={!o} onClick={() => o && exportOverview(o)}>
            <Download className="size-4" />
            CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" />
            PDF
          </Button>
        </div>
      </div>

      {overview.error ? (
        <ErrorState title="Couldn't load the GBP report" description={overview.error.messages?.[0] ?? overview.error.message} />
      ) : !o ? (
        <Skeleton className="h-96 w-full" />
      ) : o.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No listings yet"
            description={
              status.data?.connected
                ? "The first refresh is still running, or the connected Google account manages no listings."
                : "Connect Google Business Profile above. Until Google approves access, you can try the reports with 150 sample listings — the first real refresh replaces them."
            }
            action={!status.data?.connected && status.data?.canManage ? <LoadSample /> : undefined}
          />
        </Card>
      ) : (
        <>
          <SummaryTiles o={o} />
          <TopPerformers o={o} rangeQs={rangeQs} />
          <NeedsAttention o={o} rangeQs={rangeQs} />
          <ListingsTable o={o} rangeQs={rangeQs} />
        </>
      )}
    </div>
  );
}

function LoadSample() {
  const { load } = useSampleData();
  const { toast } = useToast();
  return (
    <Button
      size="sm"
      loading={load.isPending}
      onClick={() =>
        load.mutate(undefined, {
          onSuccess: (r) => toast({ variant: "success", title: `Loaded ${r.listings} sample listings` }),
          onError: (e) => toast({ variant: "error", title: "Couldn't load sample data", description: e.messages?.[0] ?? e.message }),
        })
      }
    >
      Load sample data
    </Button>
  );
}

function SummaryTiles({ o }: { o: Overview }) {
  const s = o.summary;
  const t = o.totals;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Listings" value={s.total} status={s.syncIssues ? `${s.syncIssues} with sync issues` : "All synced"} tone={s.syncIssues ? "warning" : "ok"} />
        <StatTile
          label="Open on Google"
          value={s.open}
          status={s.temporarilyClosed + s.permanentlyClosed ? `${s.temporarilyClosed} temporarily · ${s.permanentlyClosed} permanently closed` : "None closed"}
          tone={s.temporarilyClosed ? "warning" : "neutral"}
        />
        <StatTile
          label="Verified"
          value={s.verification.verified}
          status={`${s.verification.pending} pending · ${s.verification.required} need verification`}
          tone={s.verification.required ? "danger" : "neutral"}
        />
        <StatTile label="Linked to a merchant" value={s.total - s.unlinked} status={s.unlinked ? `${s.unlinked} not linked yet` : "All linked"} tone={s.unlinked ? "warning" : "ok"} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {(
          [
            ["total", "Customer actions", "Website clicks + calls + directions + menu clicks + orders + bookings, all listings"],
            ["views", "Profile views", "Times a listing was shown on Google Search or Maps"],
            ["calls", "Calls", undefined],
            ["website", "Website clicks", undefined],
            ["directions", "Direction requests", undefined],
          ] as const
        ).map(([k, label, hint]) => (
          <div key={k} className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3" title={hint}>
            <span className="text-xs font-medium text-muted-foreground">{label} · all listings</span>
            <span className="text-xl font-semibold tabular-nums text-foreground">{fmtNum(t[k].current)}</span>
            <ChangeLine change={t[k].change} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TopPerformers({ o, rangeQs }: { o: Overview; rangeQs: string }) {
  return (
    <Section title="Top performing listings" aside={<span className="text-xs text-muted-foreground">Open listings with data in this period</span>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {o.topPerformers.map((t) => (
          <div key={t.key} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-card px-3.5 py-3">
            <span className="text-xs font-medium text-muted-foreground">{t.label}</span>
            {t.location ? (
              <>
                <Link href={`/web/gbp/${t.location.id}?${rangeQs}`} className="truncate text-sm font-medium text-foreground hover:underline" title={t.location.title}>
                  {t.location.title}
                </Link>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">{t.location.city}</span>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-foreground">
                    {t.key === "rating" ? (
                      <>
                        {t.value?.toFixed(1)}
                        <Star className="size-3.5 fill-current text-warning" aria-label="stars" />
                      </>
                    ) : (
                      fmtNum(t.value)
                    )}
                  </span>
                </div>
              </>
            ) : (
              <NoData />
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function NeedsAttention({ o, rangeQs }: { o: Overview; rangeQs: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const items = code ? o.attention.filter((a) => a.flags.some((f) => f.code === code)) : o.attention;
  const shown = all ? items : items.slice(0, 8);
  const codes = Object.entries(o.flagCounts).sort((a, b) => b[1] - a[1]);
  const labelOf = (c: string) => o.attention.flatMap((a) => a.flags).find((f) => f.code === c)?.label ?? c;

  return (
    <Section
      title="Needs attention"
      aside={<span className="text-xs text-muted-foreground">{o.attention.length} listings flagged · monitoring only</span>}
    >
      {codes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 print:hidden">
          <FlagChip on={!code} onClick={() => setCode(null)}>
            All
          </FlagChip>
          {codes.map(([c, n]) => (
            <FlagChip key={c} on={code === c} onClick={() => setCode(code === c ? null : c)}>
              {labelOf(c)} <span className="tabular-nums opacity-70">{n}</span>
            </FlagChip>
          ))}
        </div>
      )}
      <Card>
        {items.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Nothing flagged for this period.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map(({ location, flags }) => (
              <li key={location.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-2.5">
                <div className="min-w-48 flex-1">
                  <Link href={`/web/gbp/${location.id}?${rangeQs}`} className="text-sm font-medium text-foreground hover:underline">
                    {location.title}
                  </Link>
                  <div className="text-xs text-muted-foreground">{location.city}</div>
                </div>
                <div className="flex flex-[2] flex-wrap gap-1.5">
                  {flags.map((f) => (
                      <span
                        key={f.code}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                          f.code === code ? "border-primary-border bg-accent text-foreground" : "border-border text-muted-foreground",
                        )}
                        title={f.detail}
                      >
                        {SEVERE.has(f.code) && <TriangleAlert className="size-3.5 text-warning-text" aria-hidden />}
                        <span className="text-foreground">{f.label}</span>
                        {f.detail && <span>· {f.detail}</span>}
                      </span>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {items.length > 8 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t border-border py-2 text-xs font-medium text-muted-foreground hover:bg-secondary print:hidden">
            {all ? "Show fewer" : `Show all ${items.length}`}
          </button>
        )}
      </Card>
    </Section>
  );
}

const SEVERE = new Set(["sync_failed", "verification_required", "temporarily_closed", "zero_calls", "zero_website", "zero_directions"]);

function FlagChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
        on ? "border-primary bg-accent text-primary-subtle-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

type SortKey = "title" | "total" | "website" | "calls" | "directions" | "menu" | "orders" | "views" | "newReviews" | "totalReviews" | "rating" | "profilePct";
const COLS: { key: SortKey; label: string; hint?: string }[] = [
  { key: "total", label: "Actions", hint: "Website + calls + directions + menu + orders + bookings" },
  { key: "views", label: "Views" },
  { key: "website", label: "Website" },
  { key: "calls", label: "Calls" },
  { key: "directions", label: "Directions" },
  { key: "menu", label: "Menu" },
  { key: "orders", label: "Orders" },
  { key: "newReviews", label: "New reviews" },
  { key: "totalReviews", label: "Reviews" },
  { key: "rating", label: "Rating" },
  { key: "profilePct", label: "Profile" },
];
const PAGE = 25;

function ListingsTable({ o, rangeQs }: { o: Overview; rangeQs: string }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState("all");
  const [sync, setSync] = useState("all");
  const [ver, setVer] = useState("all");
  const [linked, setLinked] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "total", dir: "desc" });
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = o.rows.filter(
      (r) =>
        (!q || [r.title, r.city, r.storeCode, r.merchant?.name].some((v) => v?.toLowerCase().includes(q))) &&
        (open === "all" || (open === "open" ? r.openStatus === "OPEN" || r.openStatus === "UNKNOWN" : r.openStatus === open)) &&
        (sync === "all" || (sync === "ok" ? r.syncState === "ok" : r.syncState !== "ok")) &&
        (ver === "all" || r.verification === ver) &&
        (linked === "all" || (linked === "linked" ? !!r.merchant : !r.merchant)),
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.key === "title") return a.title.localeCompare(b.title) * dir;
      const av = a[sort.key] as number | null;
      const bv = b[sort.key] as number | null;
      if (av == null && bv == null) return a.title.localeCompare(b.title);
      if (av == null) return 1; // no data always sinks
      if (bv == null) return -1;
      return (av - bv) * dir || a.title.localeCompare(b.title);
    });
  }, [o.rows, search, open, sync, ver, linked, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const safe = Math.min(page, pages);
  const slice = rows.slice((safe - 1) * PAGE, safe * PAGE);
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1));
  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
  const dirOf = (key: SortKey): SortDirection => (sort.key === key ? sort.dir : false);

  return (
    <Section title="All listings" aside={<span className="text-xs text-muted-foreground">Click a row for the full listing report</span>}>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Search listings</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Name, city, store code or merchant" className="pl-8" />
        </label>
        <Select value={open} onChange={(e) => reset(setOpen)(e.target.value)} className="w-44" aria-label="Open status">
          <option value="all">Status: all</option>
          <option value="open">Open</option>
          <option value="CLOSED_TEMPORARILY">{OPEN_STATUS.CLOSED_TEMPORARILY.label}</option>
          <option value="CLOSED_PERMANENTLY">{OPEN_STATUS.CLOSED_PERMANENTLY.label}</option>
        </Select>
        <Select value={ver} onChange={(e) => reset(setVer)(e.target.value)} className="w-48" aria-label="Verification">
          <option value="all">Verification: all</option>
          {(["verified", "pending", "required"] as const).map((v) => (
            <option key={v} value={v}>
              {VERIFICATION[v].label}
            </option>
          ))}
        </Select>
        <Select value={sync} onChange={(e) => reset(setSync)(e.target.value)} className="w-40" aria-label="Sync">
          <option value="all">Sync: all</option>
          <option value="ok">Synced</option>
          <option value="issues">Sync issues</option>
        </Select>
        <Select value={linked} onChange={(e) => reset(setLinked)(e.target.value)} className="w-44" aria-label="Merchant link">
          <option value="all">Merchant: all</option>
          <option value="linked">Linked</option>
          <option value="unlinked">Not linked</option>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead sortable sortDirection={dirOf("title")} onSort={() => sortBy("title")}>
              Listing
            </TableHead>
            <TableHead>Status</TableHead>
            {COLS.map((c) => (
              <TableHead key={c.key} align="right" sortable sortDirection={dirOf(c.key)} onSort={() => sortBy(c.key)} title={c.hint}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {slice.map((r) => (
            <TableRow key={r.id} interactive onClick={() => router.push(`/web/gbp/${r.id}?${rangeQs}`)}>
              <TableCell className="max-w-72">
                <div className="flex items-center gap-1.5">
                  <Link href={`/web/gbp/${r.id}?${rangeQs}`} onClick={(e) => e.stopPropagation()} className="truncate font-medium text-foreground hover:underline">
                    {r.title}
                  </Link>
                  {r.isNew && <Badge tone="accent">New</Badge>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[r.city, r.merchant ? `Merchant: ${r.merchant.name}` : "No merchant linked"].filter(Boolean).join(" · ")}
                </div>
              </TableCell>
              <TableCell>
                <StatusBadges openStatus={r.openStatus} verification={r.verification} syncState={r.syncState} />
              </TableCell>
              {COLS.map((c) => (
                <TableCell key={c.key} align="right" className="whitespace-nowrap">
                  {cell(r, c.key)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {slice.length === 0 && (
            <TableMessageRow colSpan={COLS.length + 2}>
              <p className="py-6 text-center text-sm text-muted-foreground">No listings match these filters.</p>
            </TableMessageRow>
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between print:hidden">
        <span className="text-xs text-muted-foreground">
          {rows.length} of {o.rows.length} listings · page {safe} of {pages}
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" disabled={safe <= 1} onClick={() => setPage(safe - 1)} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="outline" disabled={safe >= pages} onClick={() => setPage(safe + 1)} aria-label="Next page">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </Section>
  );
}

function cell(r: OverviewRow, key: SortKey): React.ReactNode {
  if (key === "rating") return r.rating == null ? <NoData label="No reviews" /> : r.rating.toFixed(1);
  if (key === "profilePct") return <span className={r.profilePct < 60 ? "text-warning-text" : undefined}>{r.profilePct}%</span>;
  if (key === "newReviews" || key === "totalReviews") return fmtNum(r[key]);
  if (!r.hasData) return <NoData />;
  return fmtNum(r[key] as number | null);
}

function exportOverview(o: Overview) {
  const header = [
    "Listing", "City", "Store code", "Merchant", "Status", "Verification", "Sync",
    "Customer actions", "Views", "Website clicks", "Calls", "Directions", "Menu clicks", "Orders",
    "New reviews", "Total reviews", "Rating", "Profile completion %",
  ];
  const rows = [...o.rows]
    .sort((a, b) => (b.total ?? -1) - (a.total ?? -1))
    .map((r) => [
      r.title, r.city, r.storeCode, r.merchant?.name ?? "", OPEN_STATUS[r.openStatus].label, VERIFICATION[r.verification].label, r.syncState,
      ...(r.hasData ? [r.total, r.views, r.website, r.calls, r.directions, r.menu, r.orders] : Array(7).fill("No data")),
      r.newReviews, r.totalReviews, r.rating ?? "", r.profilePct,
    ]);
  downloadCsv(`gbp-all-listings-${o.range.start}-to-${o.range.end}.csv`, [
    [`GBP report — all listings`, `${o.range.start} to ${o.range.end}`, `Network actions ${changeText(o.totals.total.change)}`],
    [],
    header,
    ...rows,
  ]);
}
