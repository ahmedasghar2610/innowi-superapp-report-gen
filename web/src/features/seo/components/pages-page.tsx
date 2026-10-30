"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Search } from "lucide-react";
import { Badge, Button, ErrorState, Input, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableMessageRow, TableRow } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useSitePages } from "../api";
import { downloadCsv, fmtAgo, fmtMonthIso, fmtNum, PAGE_TYPE } from "../lib";
import type { PageRow } from "../types";
import { Chip, DemoBadge, HeadHint, InfoNote, SeverityBadge } from "./parts";
import { usePager } from "./pager";

/** /web/seo/sites/[siteId]/pages — every page we know of (checked + Search Console), read-only. */
export function PagesPage({ id }: { id: string }) {
  const q = useSitePages(id);
  const [type, setType] = useState("");
  const [issue, setIssue] = useState("");
  const [search, setSearch] = useState("");
  const d = q.data;

  const rows = useMemo(() => {
    if (!d) return [];
    const t = search.trim().toLowerCase();
    return d.rows.filter(
      (r) =>
        (!type || r.type === type) &&
        (!t || r.path.toLowerCase().includes(t) || (r.title ?? "").toLowerCase().includes(t)) &&
        (!issue || (issue === "any" ? r.issues.length > 0 : issue === "unchecked" ? !r.checked : r.issues.some((i) => i.severity === issue))),
    );
  }, [d, type, issue, search]);
  const pg = usePager(rows);

  if (q.error) return <ErrorState title="Couldn't load the pages" description={q.error.message} />;
  if (!d) return <Skeleton className="h-96 w-full" />;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href={`/web/seo/sites/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          {d.site.name}
        </Link>
        <h2 className="text-xl font-semibold tracking-[-0.006em] text-foreground">Pages</h2>
        {d.isDemo && <DemoBadge />}
        <span className="text-xs text-muted-foreground">{d.month ? `Clicks and impressions: ${fmtMonthIso(d.month)}` : "No Search Console data yet"}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => exportCsv(d.site.domain, rows)}>
          <Download className="size-4" />
          CSV
        </Button>
      </div>
      <InfoNote>
        Read-only. The home page and the pages with the most Google clicks are fetched and checked on every sync; the rest are listed from Search Console. &quot;Edit&quot;
        opens the page editor as a UI preview — editing and publishing are on hold.
      </InfoNote>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Search pages</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Path or title" className="pl-8" />
        </label>
        <Select value={issue} onChange={(e) => setIssue(e.target.value)} className="w-44" aria-label="Issues">
          <option value="">Issues: all pages</option>
          <option value="any">With any issue</option>
          <option value="S1">With S1 issues</option>
          <option value="S2">With S2 issues</option>
          <option value="unchecked">Not checked</option>
        </Select>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Page type">
          {[["", "All", d.rows.length] as const, ...Object.entries(d.types).map(([k, n]) => [k, PAGE_TYPE[k] ?? k, n] as const)].map(([k, label, n]) => (
            <Chip key={k || "all"} on={type === k} onClick={() => setType(k)} count={n}>
              {label}
            </Chip>
          ))}
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-52">Page</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead align="right">Clicks</TableHead>
            <TableHead align="right">Impressions</TableHead>
            <TableHead align="right">Position</TableHead>
            <TableHead align="right">
              <HeadHint label="PageSpeed" hint="Mobile Lighthouse performance score (PageSpeed Insights)" />
            </TableHead>
            <TableHead>
              <HeadHint label="CWV" hint="Core Web Vitals from real Chrome users. 'No data' = too little traffic for Google to measure." />
            </TableHead>
            <TableHead className="min-w-52">Issues</TableHead>
            <TableHead>Checked</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pg.rows.map((r) => (
            <TableRow key={r.url}>
              <TableCell className="max-w-64">
                <a href={r.url} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs text-foreground hover:underline" title={r.url}>
                  {r.path}
                </a>
                <div className="truncate text-xs text-muted-foreground" title={r.title ?? undefined}>
                  {r.title ?? (r.checked ? "No title" : "")}
                  {r.titleLength != null && <span className={cn("ml-1", r.titleLength > 60 && "text-warning-text")}>({r.titleLength})</span>}
                </div>
              </TableCell>
              <TableCell>
                <Badge tone="neutral" icon={false}>
                  {PAGE_TYPE[r.type] ?? r.type}
                </Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <PageStatus r={r} />
              </TableCell>
              <TableCell align="right">{fmtNum(r.clicks)}</TableCell>
              <TableCell align="right">{fmtNum(r.impressions)}</TableCell>
              <TableCell align="right">{r.position ?? "—"}</TableCell>
              <TableCell align="right">
                {r.psiScore == null ? <span className="text-muted-foreground">—</span> : <span className={cn("font-medium", r.psiScore >= 90 ? "text-success-subtle-foreground" : r.psiScore >= 50 ? "text-warning-text" : "text-text-destructive")}>{r.psiScore}</span>}
              </TableCell>
              <TableCell>
                {r.cwv === "pass" ? <Badge tone="success">Pass</Badge> : r.cwv === "fail" ? <Badge tone="danger">Fail</Badge> : r.cwv === "none" ? <span className="text-xs text-muted-foreground">No data</span> : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>
                {r.issues.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{r.checked ? "None" : "—"}</span>
                ) : (
                  <span className="flex flex-col gap-1">
                    {r.issues.slice(0, 3).map((i) => (
                      <span key={i.code} className="inline-flex items-center gap-1.5 text-xs text-foreground">
                        <SeverityBadge s={i.severity} />
                        {i.label}
                      </span>
                    ))}
                    {r.issues.length > 3 && <span className="text-xs text-muted-foreground">+{r.issues.length - 3} more</span>}
                  </span>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                <div>{r.lastCrawlAt ? fmtAgo(r.lastCrawlAt) : "Not checked"}</div>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableMessageRow colSpan={10}>
              <p className="py-6 text-center text-sm text-muted-foreground">No pages match.</p>
            </TableMessageRow>
          )}
        </TableBody>
      </Table>
      {pg.bar}
    </>
  );
}

function PageStatus({ r }: { r: PageRow }) {
  if (!r.checked) return <span className="text-xs text-muted-foreground">Not checked</span>;
  if (r.crawlError) return <Badge tone="danger" title={r.crawlError}>Unreachable</Badge>;
  if ((r.statusCode ?? 0) >= 400) return <Badge tone="danger">HTTP {r.statusCode}</Badge>;
  if (r.noindex) return <Badge tone="warning">Noindex</Badge>;
  if (r.indexVerdict && r.indexVerdict !== "PASS") return <Badge tone="warning" title={r.coverageState ?? undefined}>Not indexed</Badge>;
  return <Badge tone="success" title={r.coverageState ?? undefined}>{r.indexVerdict === "PASS" ? "Indexed" : "OK"}</Badge>;
}

function exportCsv(domain: string, rows: PageRow[]) {
  downloadCsv(`seo-pages-${domain}.csv`, [
    ["URL", "Type", "HTTP", "Title", "Title length", "Meta length", "H1s", "Noindex", "Index status", "Clicks", "Impressions", "Position", "PageSpeed", "CWV", "Issues"],
    ...rows.map((r) => [
      r.url, r.type, r.statusCode ?? "", r.title ?? "", r.titleLength ?? "", r.metaLength ?? "", r.h1Count ?? "", r.noindex ? "yes" : "", r.coverageState ?? "",
      r.clicks, r.impressions, r.position ?? "", r.psiScore ?? "", r.cwv ?? "", r.issues.map((i) => `${i.severity} ${i.label}`).join("; "),
    ]),
  ]);
}
