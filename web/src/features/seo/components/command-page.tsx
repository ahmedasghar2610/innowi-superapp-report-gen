"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, GitCompareArrows, Search, TriangleAlert } from "lucide-react";
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
  type SortDirection,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useSeoOverview, useSeoStatus, useWatchdog } from "../api";
import { downloadCsv, fmtAgo, fmtNum, gradeOf, PACKAGE } from "../lib";
import type { Overview, OverviewRow, Package } from "../types";
import { ChangeText, DemoBadge, GradeBadge, HeadHint, HealthScore, PackageBadge, PillarHeat, Section, Segmented, SeverityBadge, SourcePills, Sparkline } from "./parts";
import { usePager } from "./pager";

type SortKey = "health" | "name" | "crit" | "clicks" | "clicksChange";

/** /web/seo — SEO Command: every site, worst first, with the live alert feed beside it. */
export function CommandPage() {
  const status = useSeoStatus();
  const q = useSeoOverview();
  const o = q.data;

  if (q.error) return <ErrorState title="Couldn't load SEO Command" description={q.error.message} />;
  if (!o) return <Skeleton className="h-96 w-full" />;
  if (!o.rows.length) {
    return (
      <Card>
        <EmptyState
          icon={Search}
          title="No sites yet"
          description={
            status.data?.connected
              ? "The first refresh is still running, or the connected Google account has no Search Console properties. Add sites by hand in Site settings."
              : "Connect Search Console & GA4 above, add a site by hand in Site settings, or load sample data to try the pages."
          }
        />
      </Card>
    );
  }
  return <Body o={o} />;
}

function Body({ o }: { o: Overview }) {
  const s = o.summary;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm text-muted-foreground">
          All {s.sites} sites ({s.active} active) · average health <b className="text-foreground">{s.avgHealth ?? "—"}</b>
          {s.scored < s.sites && ` · ${s.sites - s.scored} not scored yet`} · sorted worst-first
        </span>
        <Link href="/web/seo/reports" className="ml-auto inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
          Reports Center · <b className="text-sm text-foreground">{s.reportsDue7}</b> due this week
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="S1 critical alerts" value={s.s1} status={s.s1Overdue ? `${s.s1Overdue} past same-day SLA` : "Respond same business day"} tone={s.s1Overdue ? "danger" : s.s1 ? "warning" : "ok"} href="/web/seo/intelligence?severity=S1" />
        <StatTile label="S2 major alerts" value={s.s2} status="Respond within 48 h" tone={s.s2 ? "warning" : "neutral"} href="/web/seo/intelligence?severity=S2" hint={`${s.s3} S3 (hygiene) alerts too — respond within a week.`} />
        <StatTile
          label="Tracking integrity"
          value={s.tracking.pct == null ? "—" : `${s.tracking.pct}%`}
          status={s.tracking.linked ? `${s.tracking.broken} sites with broken tracking` : "No GA4 linked yet"}
          tone={s.tracking.broken ? "danger" : s.tracking.linked ? "ok" : "neutral"}
        />
        <StatTile
          label="Pending connections"
          value={s.pendingConnections}
          status={s.pendingConnections ? "Missing Search Console or GA4" : "All sites connected"}
          tone={s.pendingConnections ? "warning" : "ok"}
          href="/web/seo/site-settings"
        />
      </div>
      <SourcePills sources={o.sources} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <SitesTable o={o} />
        <WatchdogPanel />
      </div>
    </>
  );
}

function SitesTable({ o }: { o: Overview }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [pkg, setPkg] = useState<"" | Package>("");
  const [grade, setGrade] = useState("");
  const [critOnly, setCritOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "health", dir: "asc" });
  const [comparing, setComparing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [compact, setCompact] = useState(false);

  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    const list = o.rows.filter(
      (r) =>
        (!t || [r.name, r.domain, r.merchant?.name, r.owner?.name].some((v) => v?.toLowerCase().includes(t))) &&
        (!pkg || r.package === pkg) &&
        (!grade || (grade === "none" ? r.health == null : gradeOf(r.health) === grade)) &&
        (!critOnly || r.crit > 0),
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      if (sort.key === "name") return a.name.localeCompare(b.name) * dir;
      const av = a[sort.key] as number | null;
      const bv = b[sort.key] as number | null;
      if (av == null && bv == null) return a.name.localeCompare(b.name);
      if (av == null) return 1; // no data always sinks
      if (bv == null) return -1;
      return (av - bv) * dir || b.s1 - a.s1 || a.name.localeCompare(b.name);
    });
  }, [o.rows, search, pkg, grade, critOnly, sort]);

  const pg = usePager(rows);
  const slice = pg.rows;
  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === "desc" ? "asc" : "desc") : key === "health" ? "asc" : "desc" }));
  const dirOf = (key: SortKey): SortDirection => (sort.key === key ? sort.dir : false);
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), pg.reset());
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id]));

  return (
    <Section
      title="All sites"
      aside={
        <div className="flex items-center gap-2 print:hidden">
          <span className="text-xs text-muted-foreground">Worst first · click a row for the site scorecard</span>
          <Button size="sm" variant="outline" onClick={() => exportCsv(o, rows)}>
            <Download className="size-4" />
            CSV
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Search sites</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Site, domain, merchant or owner" className="pl-8" />
        </label>
        <Select value={pkg} onChange={(e) => reset(setPkg)(e.target.value as "" | Package)} className="w-40" aria-label="Package">
          <option value="">Package: all</option>
          {(Object.keys(PACKAGE) as Package[]).map((k) => (
            <option key={k} value={k}>
              {PACKAGE[k].label}
            </option>
          ))}
        </Select>
        <Select value={grade} onChange={(e) => reset(setGrade)(e.target.value)} className="w-40" aria-label="Grade">
          <option value="">Grade: all</option>
          {["A", "B", "C", "D"].map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
          <option value="none">Not scored</option>
        </Select>
        <ChipToggle on={critOnly} onClick={() => reset(setCritOnly)(!critOnly)}>
          <TriangleAlert className="size-3.5" />
          With S1/S2 alerts
        </ChipToggle>
        <ChipToggle
          on={comparing}
          onClick={() => {
            setComparing(!comparing);
            setPicked([]);
          }}
        >
          <GitCompareArrows className="size-3.5" />
          Compare
        </ChipToggle>
        <span className="ml-auto">
          <Segmented label="Density" value={compact ? "compact" : "comfortable"} onChange={(v) => setCompact(v === "compact")} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
        </span>
        {comparing && (
          <Button size="sm" disabled={picked.length < 2} onClick={() => router.push(`/web/seo/compare?ids=${picked.join(",")}`)}>
            Compare {picked.length} sites
          </Button>
        )}
      </div>
      {comparing && <p className="text-xs text-muted-foreground">Tick 2 to 4 sites, then press Compare.</p>}
      <Table className={cn(compact && "[&_td]:py-1 [&_td]:text-xs")}>
        <TableHeader>
          <TableRow>
            {comparing && <TableHead className="w-8" />}
            <TableHead sortable sortDirection={dirOf("name")} onSort={() => sortBy("name")} className="min-w-56">
              Site
            </TableHead>
            <TableHead>Package</TableHead>
            <TableHead sortable sortDirection={dirOf("health")} onSort={() => sortBy("health")}>
              <HeadHint label="Health" hint="0–100, weighted average of the pillars that have data. A ≥ 85 · B ≥ 70 · C ≥ 55 · D below." />
            </TableHead>
            <TableHead>
              <HeadHint label="Pillar heat" hint={o.pillarMeta.map((m) => `${m.key.toUpperCase()} = ${m.label}`).join(" · ")} />
            </TableHead>
            <TableHead sortable sortDirection={dirOf("crit")} onSort={() => sortBy("crit")}>
              Alerts
            </TableHead>
            <TableHead align="right" sortable sortDirection={dirOf("clicks")} onSort={() => sortBy("clicks")}>
              <HeadHint label="Clicks (28 d)" hint="Google Search clicks, last 28 days of Search Console data" />
            </TableHead>
            <TableHead align="right" sortable sortDirection={dirOf("clicksChange")} onSort={() => sortBy("clicksChange")}>
              vs prev.
            </TableHead>
            <TableHead>12 weeks</TableHead>
            <TableHead>
              <HeadHint label="Local" hint="Local SEO pillar grade (from the linked Google Business Profile)" />
            </TableHead>
            <TableHead>Audited</TableHead>
            <TableHead>Owner</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {slice.map((r) => (
            <TableRow key={r.id} interactive onClick={() => (comparing ? toggle(r.id) : router.push(`/web/seo/sites/${r.id}`))}>
              {comparing && (
                <TableCell>
                  <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} aria-label={`Compare ${r.name}`} className="size-4 accent-[var(--primary)]" />
                </TableCell>
              )}
              <TableCell className="max-w-72">
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-8 w-0.5 shrink-0 rounded-full", r.s1 ? "bg-destructive" : r.s2 ? "bg-warning" : r.status === "paused" ? "bg-border" : "bg-success")} aria-hidden />
                  <div className="min-w-0">
                    <Link href={`/web/seo/sites/${r.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-foreground hover:underline">
                      {r.name}
                    </Link>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="truncate">
                        {r.name.toLowerCase() === r.domain ? "" : r.domain}
                        {r.segment && (r.name.toLowerCase() === r.domain ? r.segment : ` · ${r.segment}`)}
                      </span>
                      {r.status === "paused" && <Badge tone="neutral" icon={false}>Paused</Badge>}
                      {!r.gscLinked && <Badge tone="warning" icon={false}>No Search Console</Badge>}
                      {r.syncState === "issue" && <Badge tone="danger" icon={false}>Sync issue</Badge>}
                      {r.isDemo && <DemoBadge />}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <PackageBadge p={r.package} />
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <HealthScore score={r.health} />
              </TableCell>
              <TableCell>
                <PillarHeat pillars={r.pillars} meta={o.pillarMeta} />
              </TableCell>
              <TableCell>
                <span className="inline-flex flex-wrap gap-1">
                  {r.s1 > 0 && <SevCount s="S1" n={r.s1} />}
                  {r.s2 > 0 && <SevCount s="S2" n={r.s2} />}
                  {r.s3 > 0 && <SevCount s="S3" n={r.s3} />}
                  {!r.s1 && !r.s2 && !r.s3 && <span className="text-muted-foreground">—</span>}
                </span>
              </TableCell>
              <TableCell align="right">{r.gscLinked ? fmtNum(r.clicks) : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell align="right">
                <ChangeText v={r.clicksChange} />
              </TableCell>
              <TableCell>
                <Sparkline values={r.spark} />
              </TableCell>
              <TableCell>
                <GradeBadge grade={r.localGrade} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{r.auditedAt ? fmtAgo(r.auditedAt) : "—"}</TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{r.owner?.name ?? "—"}</TableCell>
            </TableRow>
          ))}
          {slice.length === 0 && (
            <TableMessageRow colSpan={comparing ? 12 : 11}>
              <p className="py-6 text-center text-sm text-muted-foreground">No sites match these filters.</p>
            </TableMessageRow>
          )}
        </TableBody>
      </Table>
      {pg.bar}
      {(rows.length !== o.rows.length || o.dataThrough) && (
        <p className="-mt-1 text-xs text-muted-foreground">
          {rows.length !== o.rows.length && `${rows.length} of ${o.rows.length} sites match the filters`}
          {rows.length !== o.rows.length && o.dataThrough && " · "}
          {o.dataThrough && `Search Console data through ${o.dataThrough}`}
        </p>
      )}
    </Section>
  );
}

function SevCount({ s, n }: { s: "S1" | "S2" | "S3"; n: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <SeverityBadge s={s} />
      <span className="text-xs tabular-nums text-foreground">{n}</span>
    </span>
  );
}

function ChipToggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
        on ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

/** Live alert feed: open findings, S1 first. */
function WatchdogPanel() {
  const q = useWatchdog();
  const w = q.data;
  return (
    <Section
      title="Watchdog"
      aside={
        <Link href="/web/seo/intelligence" className="text-xs font-medium text-primary hover:underline">
          All in Intelligence
        </Link>
      }
    >
      <Card className="flex flex-col">
        {!w ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
              {(["S1", "S2", "S3"] as const).map((s) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <SeverityBadge s={s} />
                  {w.counts[s]} open
                </span>
              ))}
            </div>
            {w.data.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No open alerts.</p>
            ) : (
              <ul className="max-h-[38rem] divide-y divide-border overflow-y-auto">
                {w.data.map((a) => (
                  <li key={a.id}>
                    <Link href={`/web/seo/intelligence?siteId=${a.site.id}&open=${a.id}`} className="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-secondary">
                      <span className="flex items-center gap-1.5">
                        <SeverityBadge s={a.severity} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{a.title}</span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {a.site.name} · {fmtAgo(a.detectedAt)}
                        {a.overdue && <span className="text-text-destructive"> · past SLA</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </Section>
  );
}

function exportCsv(o: Overview, rows: OverviewRow[]) {
  downloadCsv(`seo-command-${o.dataThrough ?? "sites"}.csv`, [
    ["Site", "Domain", "Package", "Status", "Health", "Grade", ...o.pillarMeta.map((m) => m.label), "S1", "S2", "S3", "Clicks (28 d)", "Change", "Sessions (28 d)", "Owner", "Merchant"],
    ...rows.map((r) => [
      r.name, r.domain, PACKAGE[r.package].label, r.status, r.health ?? "", gradeOf(r.health) ?? "", ...o.pillarMeta.map((m) => r.pillars[m.key] ?? ""),
      r.s1, r.s2, r.s3, r.gscLinked ? r.clicks : "", r.clicksChange == null ? "" : `${Math.round(r.clicksChange * 100)}%`, r.sessions ?? "", r.owner?.name ?? "", r.merchant?.name ?? "",
    ]),
  ]);
}
