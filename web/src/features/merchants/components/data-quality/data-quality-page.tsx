"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plug, RefreshCw, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  type BadgeTone,
} from "@/components/ui";
import { useDataQuality } from "@/features/merchants/api";
import type { CompletenessBand, DataQualityMerchant, DataQualityResponse } from "@/features/merchants/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { MerchantHealthBadge } from "../merchant-health-badge";
import { SubscriptionStatusBadge } from "../package-badge";

/**
 * Data Quality — Super App PRD §22, M1-02 (route: /data-quality).
 *
 * Portfolio-wide read of profile completeness and field verification, worst
 * merchant first. Everything on screen comes from `GET /profiling/data-quality`
 * — thresholds included — so the page never hard-codes what "complete" means.
 * Filtering and search are client-side over the single cached response.
 */

/* ---- Band metadata (single source of truth for label / tone / bar colour) --- */

type BandMeta = { label: string; tone: BadgeTone; barClassName: string; pillClassName: string };

const BAND_META: Record<CompletenessBand, BandMeta> = {
  COMPLETE: { label: "Complete", tone: "success", barClassName: "bg-success", pillClassName: "text-success-subtle-foreground" },
  PARTIAL: { label: "Partial", tone: "warning", barClassName: "bg-warning", pillClassName: "text-warning-text" },
  CRITICAL: { label: "Critical", tone: "danger", barClassName: "bg-destructive", pillClassName: "text-text-destructive" },
  UNSCORED: { label: "Unscored", tone: "neutral", barClassName: "bg-muted-foreground", pillClassName: "text-muted-foreground" },
};

const BAND_ORDER: CompletenessBand[] = ["COMPLETE", "PARTIAL", "CRITICAL", "UNSCORED"];

function bandCount(bands: DataQualityResponse["bands"], band: CompletenessBand): number {
  switch (band) {
    case "COMPLETE":
      return bands.complete;
    case "PARTIAL":
      return bands.partial;
    case "CRITICAL":
      return bands.critical;
    case "UNSCORED":
      return bands.unscored;
  }
}

function bandCaption(thresholds: DataQualityResponse["thresholds"], band: CompletenessBand): string {
  switch (band) {
    case "COMPLETE":
      return `≥ ${thresholds.completeAtPct}% complete`;
    case "PARTIAL":
      return `${thresholds.criticalBelowPct}% – ${thresholds.completeAtPct - 1}%`;
    case "CRITICAL":
      return `< ${thresholds.criticalBelowPct}%`;
    case "UNSCORED":
      return "Never scored";
  }
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

/* ---- Page ------------------------------------------------------------------ */

export function DataQualityPage() {
  const { data, isPending, isError, error, isFetching, refetch } = useDataQuality();
  const [band, setBand] = useState<CompletenessBand | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const rows = data?.merchants ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((m) => {
      if (band && m.band !== band) return false;
      if (!q) return true;
      return (
        m.restaurantName.toLowerCase().includes(q) ||
        (m.merchantCode ? m.merchantCode.toLowerCase().includes(q) : false)
      );
    });
  }, [data, band, search]);

  const toggleBand = (next: CompletenessBand | null) => setBand((cur) => (cur === next ? null : next));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Data Quality</h1>
          <p className="mt-1 text-table text-muted-foreground">
            Profile completeness and verification across the portfolio — worst first.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && <span className="text-xs text-muted-foreground">Generated {formatDate(data.generatedAt)}</span>}
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {isError ? (
        <Card>
          <ErrorState title="Couldn't load data quality" error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <PageSkeleton />
      ) : data.totals.merchants === 0 ? (
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title="No merchants to score"
            description="Add merchants to the portfolio and their profile completeness will appear here."
          />
        </Card>
      ) : (
        <>
          <BandTiles data={data} active={band} onToggle={toggleBand} />

          {data.bands.unscored > 0 && (
            <div className="mt-4 flex items-start gap-2.5 rounded-[var(--radius-card)] border border-border bg-warning-soft px-4 py-3 text-table text-warning-text">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                <span className="font-semibold tabular-nums">{data.bands.unscored}</span>{" "}
                {data.bands.unscored === 1 ? "merchant has" : "merchants have"} never been scored. Run{" "}
                <code className="rounded bg-card px-1 py-0.5 font-mono text-xs text-foreground">
                  npm run completeness:backfill
                </code>{" "}
                on the API to compute them.
              </p>
            </div>
          )}

          <ConfidenceStrip data={data} />
          <ConnectionsRow connections={data.connections} />

          <Card className="mt-4">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-[18px] py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <FilterChip active={band === null} onClick={() => setBand(null)} label="All" count={data.totals.merchants} />
                {BAND_ORDER.map((b) => (
                  <FilterChip
                    key={b}
                    active={band === b}
                    onClick={() => toggleBand(b)}
                    label={BAND_META[b].label}
                    count={bandCount(data.bands, b)}
                  />
                ))}
              </div>
              <div className="relative ml-auto w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or merchant ID"
                  aria-label="Search merchants"
                  className="pl-8"
                />
              </div>
              <span className="w-full text-xs tabular-nums text-muted-foreground sm:w-auto">
                {filtered.length} of {data.totals.merchants} merchants
              </span>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No merchants match"
                description="Try a different search term or pick another band."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBand(null);
                      setSearch("");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <MerchantQualityTable merchants={filtered} busy={isFetching} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/* ---- Band tiles ------------------------------------------------------------ */

const TILE_TONE: Partial<Record<BadgeTone, string>> = {
  neutral: "text-foreground",
  accent: "text-primary-hover",
  success: "text-success-subtle-foreground",
  warning: "text-warning-text",
  danger: "text-text-destructive",
  dataq: "text-dataq-text",
  primary: "text-primary",
  "success-solid": "text-success",
  "warning-solid": "text-warning",
  "danger-solid": "text-destructive",
  "dataq-solid": "text-data-issue",
  outline: "text-foreground",
};

function BandTiles({
  data,
  active,
  onToggle,
}: {
  data: DataQualityResponse;
  active: CompletenessBand | null;
  onToggle: (band: CompletenessBand) => void;
}) {
  const { totals, bands, thresholds } = data;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)]">
      {BAND_ORDER.map((b) => {
        const meta = BAND_META[b];
        const selected = active === b;
        return (
          <button
            key={b}
            type="button"
            onClick={() => onToggle(b)}
            aria-pressed={selected}
            className={cn(
              "rounded-[var(--radius-card)] border bg-card p-[18px] text-left transition-colors hover:bg-secondary",
              selected ? "border-primary ring-4 ring-accent" : "border-border",
            )}
          >
            <div className={cn("text-3xl font-semibold tabular-nums leading-none", TILE_TONE[meta.tone] ?? "text-foreground")}>
              {bandCount(bands, b)}
            </div>
            <div className="mt-2 text-table font-semibold text-foreground">{meta.label}</div>
            <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">{bandCaption(thresholds, b)}</div>
          </button>
        );
      })}

      <Card className="p-[18px] sm:col-span-2 lg:col-span-1">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-2xl font-semibold tabular-nums leading-none text-foreground">
              {totals.averagePercent === null ? "—" : `${totals.averagePercent}%`}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">Average</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums leading-none text-foreground">
              {totals.medianPercent === null ? "—" : `${totals.medianPercent}%`}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">Median</div>
          </div>
        </div>
        <div className="mt-3 border-t border-border pt-2.5 text-xs tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{totals.scored}</span> of{" "}
          <span className="font-medium text-foreground">{totals.merchants}</span> scored
        </div>
      </Card>
    </div>
  );
}

/* ---- Confidence strip -------------------------------------------------------- */

const CONFIDENCE_SEGMENTS: {
  key: keyof Omit<DataQualityResponse["confidence"], "fieldSlots">;
  label: string;
  className: string;
}[] = [
  { key: "confirmed", label: "Confirmed", className: "bg-success" },
  { key: "needsReview", label: "Inferred", className: "bg-primary" },
  { key: "unverified", label: "Unverified", className: "bg-muted-foreground" },
  { key: "outdated", label: "Outdated", className: "bg-warning" },
  { key: "placeholder", label: "Placeholder", className: "bg-destructive" },
  { key: "noAttestation", label: "No attestation", className: "bg-muted" },
];

function ConfidenceStrip({ data }: { data: DataQualityResponse }) {
  const { confidence, totals } = data;
  const slots = confidence.fieldSlots;
  const fieldsPerMerchant = totals.merchants > 0 ? Math.round(slots / totals.merchants) : 0;

  return (
    <Card className="mt-4 p-[18px]">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-table font-semibold text-foreground">Field verification</h2>
      </div>

      {slots === 0 ? (
        <p className="mt-2 text-table text-muted-foreground">No profile fields recorded yet.</p>
      ) : (
        <>
          <div
            className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full border border-border bg-muted"
            role="img"
            aria-label={CONFIDENCE_SEGMENTS.map((s) => `${s.label} ${confidence[s.key]}`).join(", ")}
          >
            {CONFIDENCE_SEGMENTS.map((s) => {
              const value = confidence[s.key];
              if (value <= 0) return null;
              return (
                <span
                  key={s.key}
                  className={cn("h-full", s.className)}
                  style={{ width: `${(value / slots) * 100}%` }}
                  title={`${s.label}: ${value} (${pct(value, slots)}%)`}
                />
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-table">
            {CONFIDENCE_SEGMENTS.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-foreground">
                <span className={cn("size-2 rounded-full border border-border", s.className)} aria-hidden />
                <span className="tabular-nums font-medium">{confidence[s.key]}</span>
                <span className="text-muted-foreground">
                  {s.label} · {pct(confidence[s.key], slots)}%
                </span>
              </span>
            ))}
          </div>

          <p className="mt-2 text-xs tabular-nums text-muted-foreground">
            Field attestations across {slots} profile fields ({totals.merchants} merchants × {fieldsPerMerchant}{" "}
            fields)
          </p>
        </>
      )}
    </Card>
  );
}

/* ---- Connections ------------------------------------------------------------- */

function ConnectionsRow({ connections }: { connections: DataQualityResponse["connections"] }) {
  const stats: { value: number; label: string; className: string }[] = [
    { value: connections.pending, label: "pending connections", className: "text-foreground" },
    { value: connections.blocking, label: "blocking", className: connections.blocking > 0 ? "text-text-destructive" : "text-foreground" },
    {
      value: connections.merchantsWithBlockers,
      label: "merchants with blockers",
      className: connections.merchantsWithBlockers > 0 ? "text-text-destructive" : "text-foreground",
    },
  ];
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      {stats.map((s) => (
        <Card key={s.label} className="flex items-center gap-3 px-[18px] py-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Plug className="size-4" aria-hidden />
          </div>
          <div>
            <div className={cn("text-lg font-semibold tabular-nums leading-none", s.className)}>{s.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ---- Filter chip ------------------------------------------------------------- */

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
        active
          ? "border-primary-border bg-accent text-primary-hover"
          : "border-border bg-card text-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {label}
      <span className={cn("tabular-nums", active ? "text-primary-hover" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}

/* ---- Table -------------------------------------------------------------------- */

function MerchantQualityTable({ merchants, busy }: { merchants: DataQualityMerchant[]; busy?: boolean }) {
  const router = useRouter();
  return (
    <div className={busy ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={busy}>
      <Table className="rounded-t-none border-0">
        <TableHeader>
          <TableRow>
            <TableHead>Merchant</TableHead>
            <TableHead>Completeness</TableHead>
            <TableHead>Band</TableHead>
            <TableHead>Health</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Blockers</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {merchants.map((m) => {
            const meta = BAND_META[m.band];
            return (
              <TableRow key={m.id} interactive onClick={() => router.push(`/merchants/${m.id}/profile`, { scroll: false })}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{m.restaurantName}</span>
                    {m.merchantCode && (
                      <span className="font-mono text-xs text-muted-foreground" title="Workbook Merchant ID">
                        {m.merchantCode}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {m.profileCompletionPct === null ? (
                    <span className="text-muted-foreground">Not scored</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn("block h-full rounded-full", meta.barClassName)}
                          style={{ width: `${m.profileCompletionPct}%` }}
                        />
                      </span>
                      <span className="w-10 text-xs tabular-nums text-foreground">{m.profileCompletionPct}%</span>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge tone={meta.tone}>
                    {meta.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  <MerchantHealthBadge value={m.accountHealth} />
                </TableCell>
                <TableCell>
                  {m.subscriptionStatus ? (
                    <SubscriptionStatusBadge status={m.subscriptionStatus} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-foreground">
                  {m.accountManagerName ?? <span className="text-muted-foreground">Unassigned</span>}
                </TableCell>
                <TableCell>
                  {m.blockingConnections > 0 ? (
                    <span className="font-semibold tabular-nums text-text-destructive">{m.blockingConnections}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-foreground">{formatDate(m.updatedAt)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ---- Skeleton ------------------------------------------------------------------ */

function PageSkeleton() {
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)]">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="p-[18px]">
            <Skeleton className="h-7 w-14" />
            <Skeleton className="mt-3 h-3.5 w-20" />
            <Skeleton className="mt-2 h-3 w-24" />
          </Card>
        ))}
      </div>
      <Card className="mt-4 p-[18px]">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="mt-3 h-2.5 w-full rounded-full" />
        <div className="mt-3 flex gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-24" />
          ))}
        </div>
      </Card>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="px-[18px] py-3">
            <Skeleton className="h-5 w-10" />
            <Skeleton className="mt-2 h-3 w-28" />
          </Card>
        ))}
      </div>
      <Card className="mt-4">
        <div className="flex gap-2 border-b border-border px-[18px] py-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
        <Table className="rounded-t-none border-0">
          <TableHeader>
            <TableRow>
              <TableHead>Merchant</TableHead>
              <TableHead>Completeness</TableHead>
              <TableHead>Band</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Blockers</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-3.5 w-40" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-1.5 w-20 rounded-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-14 rounded-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3.5 w-16" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3.5 w-6" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3.5 w-20" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
