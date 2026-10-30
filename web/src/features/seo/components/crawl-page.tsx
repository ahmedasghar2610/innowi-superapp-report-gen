"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  ScanSearch,
  Search,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useCrawlPages, useSeoSite, useSiteCrawl } from "../api";
import { CrawlNow } from "./crawler";
import { fmtDateTime, fmtNum } from "../lib";
import type {
  CrawlIssue,
  CrawlOverview,
  CrawlPageQuery,
  CrawlSection,
} from "../types";
import { Section } from "./parts";
import { TablePager, usePager } from "./pager";

const PRIORITY_TONE: Record<string, "danger" | "warning" | "neutral"> = {
  High: "danger",
  Medium: "warning",
  Low: "neutral",
};
const TYPE_TONE: Record<string, "danger" | "warning" | "accent"> = {
  Issue: "danger",
  Warning: "warning",
  Opportunity: "accent",
};
const IMPORT_CMD = 'python -m scripts.seo_import_sf --folder "<export folder>"';

export function PriorityBadge({ p }: { p: string }) {
  return (
    <Badge tone={PRIORITY_TONE[p] ?? "neutral"} icon={false}>
      {p}
    </Badge>
  );
}

function Change({ now, prev }: { now: number; prev: number | null }) {
  if (prev == null || prev === now) return null;
  const better = now < prev;
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        better ? "text-success-subtle-foreground" : "text-text-destructive",
      )}
    >
      {better ? "−" : "+"}
      {fmtNum(Math.abs(now - prev))}
    </span>
  );
}

/* --------------------------------------------------------- site page card ---- */

/** Site scorecard → "Full-site crawl" summary of the newest Screaming Frog import. */
export function CrawlSummary({ siteId }: { siteId: string }) {
  const q = useSiteCrawl(siteId);
  const d = q.data;
  const href = `/web/seo/sites/${siteId}/crawl`;
  return (
    <Section
      title="Full-site crawl"
      aside={
        <div className="flex flex-wrap items-center gap-3">
          <CrawlNow siteId={siteId} compact />
          {d?.crawl ? (
            <Link
              href={href}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Open full crawl
              <ArrowRight className="size-3.5" />
            </Link>
          ) : null}
        </div>
      }
    >
      {!d ? (
        <Skeleton className="h-40 w-full" />
      ) : !d.crawl ? (
        <Card className="flex items-start gap-3 p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <ScanSearch className="size-4" />
          </span>
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              No Screaming Frog crawl yet
            </span>
            <span className="text-xs text-muted-foreground">
              Press <b>Crawl now</b>: the helper PC with Screaming Frog crawls
              the site and sends the result here. Without a helper, crawl it in
              Screaming Frog yourself and run{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                {IMPORT_CMD}
              </code>{" "}
              in the API folder.
            </span>
          </div>
        </Card>
      ) : (
        <CrawlSummaryBody d={d} href={href} />
      )}
    </Section>
  );
}

function CrawlSummaryBody({ d, href }: { d: CrawlOverview; href: string }) {
  const t = d.crawl!.totals;
  const top = d.issues.filter((i) => i.urls > 0).slice(0, 6);
  return (
    <Card className="flex flex-col gap-4 p-4">
      <p className="text-xs text-muted-foreground">
        Screaming Frog · crawled{" "}
        {fmtDateTime(d.crawl!.crawledAt ?? d.crawl!.importedAt)} ·{" "}
        {fmtNum(t.urls)} URLs ({fmtNum(t.html)} pages)
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Pages crawled"
          value={fmtNum(t.html)}
          status={`${fmtNum(t.indexable)} indexable`}
        />
        <StatTile
          label="Non-indexable"
          value={fmtNum(t.nonIndexable)}
          tone={t.nonIndexable ? "warning" : "ok"}
          status={t.nonIndexable ? "Check they're meant to be" : "None"}
        />
        <StatTile
          label="Broken (4xx/5xx)"
          value={fmtNum(t.errors4xx + t.errors5xx)}
          tone={t.errors4xx + t.errors5xx ? "danger" : "ok"}
          status={t.errors4xx + t.errors5xx ? "Fix or redirect" : "None"}
        />
        <StatTile
          label="Redirects (3xx)"
          value={fmtNum(t.redirects)}
          tone={t.redirects ? "warning" : "ok"}
          status={t.redirectChains ? `${t.redirectChains} chains` : "No chains"}
        />
        <StatTile
          label="Orphan pages"
          value={fmtNum(t.orphans)}
          tone={t.orphans ? "warning" : "ok"}
          status={t.orphans ? "Not linked from the site" : "None"}
        />
        <StatTile
          label="Avg words / page"
          value={fmtNum(t.avgWords)}
          tone={(t.avgWords ?? 0) < 200 ? "warning" : "ok"}
          status={`Avg response ${fmtNum(t.avgResponseMs)} ms`}
        />
      </div>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {top.map((i) => (
          <Link
            key={i.key}
            href={`${href}?issue=${i.key}`}
            className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent"
          >
            <PriorityBadge p={i.priority} />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {i.name}
            </span>
            <Change now={i.urls} prev={i.prevUrls} />
            <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">
              {fmtNum(i.urls)} URLs
            </span>
          </Link>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t.issuesWithUrls} issue types found ({t.issueTypes.High ?? 0} high ·{" "}
        {t.issueTypes.Medium ?? 0} medium · {t.issueTypes.Low ?? 0} low
        priority).{" "}
        <Link href={href} className="font-medium text-primary hover:underline">
          See all issues and pages
        </Link>
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------- full page ---- */

/** /web/seo/sites/[siteId]/crawl — every issue and every crawled URL from the newest import. */
export function CrawlPage({
  siteId,
  initialIssue,
}: {
  siteId: string;
  initialIssue?: string;
}) {
  const site = useSeoSite(siteId);
  const q = useSiteCrawl(siteId);
  const [tab, setTab] = useState(initialIssue ? "pages" : "issues");
  const [issueFilter, setIssueFilter] = useState(initialIssue ?? "");
  const [open, setOpen] = useState<CrawlIssue | null>(null);

  if (q.error)
    return (
      <ErrorState
        title="Couldn't load the crawl"
        description={q.error.message}
      />
    );
  const d = q.data;
  const back = (
    <Link
      href={`/web/seo/sites/${siteId}`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {site.data?.name ?? "Site"}
    </Link>
  );
  if (!d) return <Skeleton className="h-[40rem] w-full" />;
  if (!d.crawl)
    return (
      <>
        <div className="flex items-center gap-3">
          {back}
          <h2 className="text-xl font-semibold text-foreground">
            Full-site crawl
          </h2>
          <div className="ml-auto">
            <CrawlNow siteId={siteId} />
          </div>
        </div>
        <Card className="p-6 text-sm text-muted-foreground">
          No crawl for this site yet. Press <b>Crawl now</b> (a helper PC with
          Screaming Frog does it), or crawl it yourself and run{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {IMPORT_CMD}
          </code>{" "}
          in the API folder.
        </Card>
      </>
    );
  const t = d.crawl.totals;
  const withUrls = d.issues.filter((i) => i.urls > 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {back}
        <h2 className="text-xl font-semibold tracking-[-0.006em] text-foreground">
          Full-site crawl
        </h2>
        <Badge tone="outline" icon={false}>
          Screaming Frog
        </Badge>
        <span className="text-xs text-muted-foreground">
          Crawled {fmtDateTime(d.crawl.crawledAt ?? d.crawl.importedAt)} ·
          imported {fmtDateTime(d.crawl.importedAt)}
          {d.history.length > 1 &&
            ` · ${d.history.length} crawls imported (changes are vs the previous one)`}
        </span>
        <div className="ml-auto print:hidden">
          <CrawlNow siteId={siteId} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatTile
          label="URLs crawled"
          value={fmtNum(t.urls)}
          status={`${fmtNum(t.html)} pages`}
        />
        <StatTile label="Indexable" value={fmtNum(t.indexable)} tone="ok" />
        <StatTile
          label="Non-indexable"
          value={fmtNum(t.nonIndexable)}
          tone={t.nonIndexable ? "warning" : "ok"}
        />
        <StatTile
          label="Broken (4xx/5xx)"
          value={fmtNum(t.errors4xx + t.errors5xx)}
          tone={t.errors4xx + t.errors5xx ? "danger" : "ok"}
        />
        <StatTile
          label="Redirects"
          value={fmtNum(t.redirects)}
          tone={t.redirects ? "warning" : "ok"}
          status={`${t.redirectChains ?? 0} chains`}
        />
        <StatTile
          label="Orphan pages"
          value={fmtNum(t.orphans)}
          tone={t.orphans ? "warning" : "ok"}
        />
        <StatTile
          label="Schema errors"
          value={fmtNum(t.schemaErrors)}
          tone={t.schemaErrors ? "danger" : "ok"}
        />
        <StatTile
          label="Avg words / page"
          value={fmtNum(t.avgWords)}
          tone={(t.avgWords ?? 0) < 200 ? "warning" : "ok"}
          status={`${fmtNum(t.avgResponseMs)} ms avg response`}
        />
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="issues" count={withUrls.length}>
            Issues
          </TabsTrigger>
          {d.sections.length > 0 && (
            <TabsTrigger value="sections" count={d.sections.length}>
              Sections
            </TabsTrigger>
          )}
          <TabsTrigger value="pages" count={t.html}>
            Pages
          </TabsTrigger>
        </TabsList>
        <TabsContent value="issues">
          <IssuesTable issues={d.issues} onOpen={setOpen} />
        </TabsContent>
        <TabsContent value="sections">
          <SectionsTable
            sections={d.sections}
            onIssue={(k) => {
              setIssueFilter(k);
              setTab("pages");
            }}
          />
        </TabsContent>
        <TabsContent value="pages">
          <PagesTable
            siteId={siteId}
            issues={withUrls}
            issue={issueFilter}
            onIssue={setIssueFilter}
          />
        </TabsContent>
      </Tabs>
      <IssueDrawer
        issue={open}
        onClose={() => setOpen(null)}
        onShowPages={(k) => {
          setIssueFilter(k);
          setTab("pages");
          setOpen(null);
        }}
      />
    </>
  );
}

function SectionsTable({
  sections,
  onIssue,
}: {
  sections: CrawlSection[];
  onIssue: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        The crawl split by part of the site, from each page&apos;s address.
        &quot;No errors&quot; uses the same rule as the Audits pillar;
        low-priority warnings (such as missing security headers) are left out of
        &quot;Most common problem&quot;. This view doesn&apos;t change any
        score.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">Section</TableHead>
            <TableHead align="right">Pages</TableHead>
            <TableHead className="min-w-40">No errors</TableHead>
            <TableHead align="right">Broken</TableHead>
            <TableHead align="right">Blocked from Google</TableHead>
            <TableHead align="right">Avg words</TableHead>
            <TableHead className="min-w-64">Most common problem</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sections.map((s) => (
            <TableRow key={s.key}>
              <TableCell>
                <div className="font-medium text-foreground">{s.label}</div>
                <div
                  className="max-w-72 truncate font-mono text-xs text-muted-foreground"
                  title={s.examples.join("\n")}
                >
                  {s.examples.join(" · ")}
                </div>
              </TableCell>
              <TableCell align="right" className="tabular-nums">
                {fmtNum(s.pages)}
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        s.clean >= 80
                          ? "bg-success"
                          : s.clean >= 50
                            ? "bg-warning"
                            : "bg-destructive",
                      )}
                      style={{ width: `${s.clean}%` }}
                    />
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {s.clean}% · {fmtNum(s.pages - s.withErrors)} of{" "}
                    {fmtNum(s.pages)}
                  </span>
                </span>
              </TableCell>
              <TableCell
                align="right"
                className={cn(
                  "tabular-nums",
                  s.broken
                    ? "font-medium text-text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {fmtNum(s.broken)}
              </TableCell>
              <TableCell
                align="right"
                className={cn(
                  "tabular-nums",
                  s.blocked
                    ? "font-medium text-warning-text"
                    : "text-muted-foreground",
                )}
              >
                {fmtNum(s.blocked)}
              </TableCell>
              <TableCell align="right" className="tabular-nums">
                {s.avgWords == null ? (
                  "—"
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {fmtNum(s.avgWords)}
                    {s.thin && (
                      <Badge tone="warning" icon={false}>
                        Thin
                      </Badge>
                    )}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {s.topIssue ? (
                  <button
                    type="button"
                    className="text-left text-sm text-foreground hover:underline"
                    onClick={() => onIssue(s.topIssue!.key)}
                  >
                    {s.topIssue.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {fmtNum(s.topIssue.pages)} of {fmtNum(s.pages)} pages
                    </span>
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">None</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function IssuesTable({
  issues,
  onOpen,
}: {
  issues: CrawlIssue[];
  onOpen: (i: CrawlIssue) => void;
}) {
  const [prio, setPrio] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const rows = issues.filter(
    (i) => (showEmpty || i.urls > 0) && (!prio || i.priority === prio),
  );
  const pg = usePager(rows);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={prio}
          onChange={(e) => setPrio(e.target.value)}
          className="w-40"
          aria-label="Priority"
        >
          <option value="">All priorities</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </Select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showEmpty}
            onChange={(e) => setShowEmpty(e.target.checked)}
            className="size-3.5 accent-[var(--primary)]"
          />
          Show checks with no URLs
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          Click an issue for what it means, how to fix it and example URLs.
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-72">Issue</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead align="right">URLs</TableHead>
            <TableHead align="right">% of crawl</TableHead>
            <TableHead align="right">vs previous</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pg.rows.map((i) => (
            <TableRow key={i.key} interactive onClick={() => onOpen(i)}>
              <TableCell className="font-medium">{i.name}</TableCell>
              <TableCell>
                <Badge tone={TYPE_TONE[i.type] ?? "neutral"} icon={false}>
                  {i.type}
                </Badge>
              </TableCell>
              <TableCell>
                <PriorityBadge p={i.priority} />
              </TableCell>
              <TableCell align="right">{fmtNum(i.urls)}</TableCell>
              <TableCell align="right" className="text-muted-foreground">
                {i.pct == null ? "—" : `${i.pct.toFixed(1)}%`}
              </TableCell>
              <TableCell align="right">
                {i.prevUrls == null ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <Change now={i.urls} prev={i.prevUrls} />
                )}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableMessageRow colSpan={6}>
              <p className="py-6 text-center text-sm text-muted-foreground">
                No issues match.
              </p>
            </TableMessageRow>
          )}
        </TableBody>
      </Table>
      {pg.bar}
    </div>
  );
}

function IssueDrawer({
  issue,
  onClose,
  onShowPages,
}: {
  issue: CrawlIssue | null;
  onClose: () => void;
  onShowPages: (key: string) => void;
}) {
  const cols = useMemo(
    () =>
      issue?.sample[0]
        ? Object.keys(issue.sample[0]).filter((c) => c !== "url")
        : [],
    [issue],
  );
  return (
    <Dialog
      open={!!issue}
      onClose={onClose}
      title={issue?.name}
      description={
        issue
          ? `${issue.type} · ${issue.priority} priority · ${fmtNum(issue.urls)} URLs`
          : undefined
      }
      size="3xl"
    >
      {issue && (
        <div className="flex flex-col gap-5 text-sm">
          {issue.description && (
            <p className="text-foreground">{issue.description}</p>
          )}
          {issue.howToFix && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                How to fix
              </div>
              <p className="text-foreground">{issue.howToFix}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {issue.sample.length > 0 && (
              <Button size="sm" onClick={() => onShowPages(issue.key)}>
                Show affected pages
              </Button>
            )}
            {issue.helpUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  window.open(issue.helpUrl!, "_blank", "noopener")
                }
              >
                <ExternalLink className="size-4" />
                Screaming Frog guide
              </Button>
            )}
          </div>
          {issue.sample.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Examples ({issue.sample.length} of {fmtNum(issue.urls)})
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL</TableHead>
                    {cols.map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issue.sample.map((r, n) => (
                    <TableRow key={n}>
                      <TableCell
                        className="max-w-72 truncate font-mono text-xs"
                        title={r.url ?? undefined}
                      >
                        {r.url}
                      </TableCell>
                      {cols.map((c) => (
                        <TableCell
                          key={c}
                          className="max-w-56 truncate text-xs"
                          title={r[c] ?? undefined}
                        >
                          {r[c] || "—"}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {issue.linksSample.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Where it&apos;s linked from
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>From page</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Anchor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issue.linksSample.map((l, n) => (
                    <TableRow key={n}>
                      <TableCell
                        className="max-w-56 truncate font-mono text-xs"
                        title={l.source ?? undefined}
                      >
                        {l.source}
                      </TableCell>
                      <TableCell
                        className="max-w-56 truncate font-mono text-xs"
                        title={l.destination ?? undefined}
                      >
                        {l.destination}
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-xs">
                        {l.anchor || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function PagesTable({
  siteId,
  issues,
  issue,
  onIssue,
}: {
  siteId: string;
  issues: CrawlIssue[];
  issue: string;
  onIssue: (k: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<NonNullable<CrawlPageQuery["kind"]>>("html");
  const [sort, setSort] =
    useState<NonNullable<CrawlPageQuery["sort"]>>("score");
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(50);
  const q = useCrawlPages(siteId, {
    q: search,
    issue,
    kind: issue ? "all" : kind,
    sort,
    offset: page * limit,
    limit,
  });
  const d = q.data;
  const reset =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setPage(0);
    };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Search pages</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => reset(setSearch)(e.target.value)}
            placeholder="URL, title or H1"
            className="pl-8"
          />
        </label>
        <Select
          value={issue}
          onChange={(e) => reset(onIssue)(e.target.value)}
          className="w-72"
          aria-label="Issue"
        >
          <option value="">Any issue</option>
          {issues.map((i) => (
            <option key={i.key} value={i.key}>
              {i.name} ({fmtNum(i.urls)})
            </option>
          ))}
        </Select>
        <Select
          value={kind}
          onChange={(e) => reset(setKind)(e.target.value as typeof kind)}
          className="w-44"
          aria-label="Which URLs"
          disabled={!!issue}
        >
          <option value="html">HTML pages</option>
          <option value="nonindexable">Non-indexable pages</option>
          <option value="errors">Redirects &amp; errors</option>
          <option value="all">All URLs (incl. files)</option>
        </Select>
        <Select
          value={sort}
          onChange={(e) => reset(setSort)(e.target.value as typeof sort)}
          className="w-44"
          aria-label="Sort"
        >
          <option value="score">Most important first</option>
          <option value="issues">Most issues first</option>
          <option value="words">Fewest words first</option>
          <option value="depth">Shallowest first</option>
          <option value="inlinks">Most linked-to first</option>
          <option value="response">Slowest first</option>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-72">Page</TableHead>
            <TableHead>Status</TableHead>
            <TableHead align="right">Depth</TableHead>
            <TableHead align="right">Inlinks</TableHead>
            <TableHead align="right">Words</TableHead>
            <TableHead align="right">Response</TableHead>
            <TableHead className="min-w-52">Issues</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d?.rows.map((r) => (
            <TableRow key={r.url}>
              <TableCell className="max-w-96">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-mono text-xs text-foreground hover:underline"
                  title={r.url}
                >
                  {r.path}
                </a>
                <div
                  className="truncate text-xs text-muted-foreground"
                  title={r.title ?? undefined}
                >
                  {r.title ??
                    (r.contentType?.startsWith("text/html")
                      ? "No title"
                      : r.contentType)}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <Badge
                  tone={
                    (r.statusCode ?? 0) >= 400
                      ? "danger"
                      : (r.statusCode ?? 0) >= 300
                        ? "warning"
                        : "success"
                  }
                  icon={false}
                >
                  {r.statusCode ?? "—"}
                </Badge>
                {r.indexable === false && (
                  <div className="mt-0.5 text-[11px] text-warning-text">
                    {r.indexabilityStatus ?? "Non-indexable"}
                  </div>
                )}
              </TableCell>
              <TableCell align="right">{fmtNum(r.crawlDepth)}</TableCell>
              <TableCell align="right">{fmtNum(r.inlinks)}</TableCell>
              <TableCell
                align="right"
                className={cn(
                  (r.wordCount ?? 999) < 200 &&
                    r.contentType?.startsWith("text/html") &&
                    "text-warning-text",
                )}
              >
                {fmtNum(r.wordCount)}
              </TableCell>
              <TableCell align="right" className="text-muted-foreground">
                {r.responseMs == null ? "—" : `${fmtNum(r.responseMs)} ms`}
              </TableCell>
              <TableCell className="text-xs">
                {r.issues.length === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : (
                  <span
                    title={r.issues.map((k) => d.issueNames[k] ?? k).join("\n")}
                  >
                    {r.issues
                      .slice(0, 2)
                      .map((k) => d.issueNames[k] ?? k)
                      .join(" · ")}
                    {r.issues.length > 2 && (
                      <span className="text-muted-foreground">
                        {" "}
                        +{r.issues.length - 2} more
                      </span>
                    )}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {d && d.rows.length === 0 && (
            <TableMessageRow colSpan={7}>
              <p className="py-6 text-center text-sm text-muted-foreground">
                No pages match.
              </p>
            </TableMessageRow>
          )}
          {!d && (
            <TableMessageRow colSpan={7}>
              <Skeleton className="h-40 w-full" />
            </TableMessageRow>
          )}
        </TableBody>
      </Table>
      {d && (
        <TablePager
          total={d.total}
          page={page + 1}
          limit={limit}
          onPage={(p) => setPage(p - 1)}
          onLimit={(n) => {
            setLimit(n);
            setPage(0);
          }}
        />
      )}
    </div>
  );
}
