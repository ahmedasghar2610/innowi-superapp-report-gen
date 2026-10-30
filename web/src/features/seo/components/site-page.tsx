"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Construction,
  ExternalLink,
  FileChartColumn,
  FileText,
  Gauge,
  Plus,
  Printer,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
  useToast,
} from "@/components/ui";
import { TrendChart } from "@/features/gbp/components/trend-chart";
import { cn } from "@/lib/utils/cn";
import {
  useAddKeyword,
  useDeleteKeyword,
  useGenerateReport,
  useRescore,
  useRunPagespeed,
  useSeoStatus,
  useSeoSite,
} from "../api";
import {
  changeOf,
  fmtAgo,
  fmtDay,
  fmtMonthIso,
  fmtNum,
  fmtPct1,
  fmtRange,
  GRADE,
  gradeOf,
  weekEnds,
} from "../lib";
import type { NapItem, PillarKey, SiteDetail } from "../types";
import {
  ChangeText,
  DemoBadge,
  Fact,
  HealthScore,
  InfoNote,
  PackageBadge,
  ReportStatusBadge,
  Section,
  SeverityBadge,
  StateBadge,
  cadenceLabel,
} from "./parts";
import { CrawlSummary } from "./crawl-page";
import { usePager } from "./pager";

/** /web/seo/sites/[siteId] — one site's scorecard. */
export function SitePage({ id }: { id: string }) {
  const q = useSeoSite(id);
  const status = useSeoStatus();
  const d = q.data;
  useEffect(() => {
    if (d?.name) document.title = `${d.name} — SEO — Innowi`;
  }, [d?.name]);

  if (q.error)
    return (
      <ErrorState
        title="Couldn't load this site"
        description={q.error.message}
      />
    );
  if (!d) return <Skeleton className="h-[40rem] w-full" />;
  const canManage = !!status.data?.canManage;

  return (
    <>
      <Header d={d} canManage={canManage} />
      <Pillars d={d} />
      <Performance d={d} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Findings d={d} />
        <LocalCard d={d} />
      </div>
      <CrawlSummary siteId={d.id} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Queries d={d} />
        <TopPages d={d} />
      </div>
      <Keywords d={d} canManage={canManage} />
      <Reports d={d} />
      <Pending d={d} />
    </>
  );
}

function Header({ d, canManage }: { d: SiteDetail; canManage: boolean }) {
  const rescore = useRescore();
  const speed = useRunPagespeed();
  const status = useSeoStatus();
  const { toast } = useToast();
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          href="/web/seo"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
        >
          <ArrowLeft className="size-4" />
          SEO Command
        </Link>
        <h2 className="text-xl font-semibold tracking-[-0.006em] text-foreground">
          {d.name}
        </h2>
        <PackageBadge p={d.package} />
        {d.status === "paused" && <Badge tone="neutral">Paused</Badge>}
        {d.isDemo && <DemoBadge />}
        <div className="ml-auto flex flex-wrap items-center gap-2 print:hidden">
          <Link
            href={`/web/seo/sites/${d.id}/pages`}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent [&_svg]:size-4"
          >
            <FileText className="size-4" />
            Pages
          </Link>
          <Link
            href={`/web/seo/site-settings?site=${d.id}`}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent [&_svg]:size-4"
          >
            <Settings className="size-4" />
            Site settings
          </Link>
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              loading={rescore.isPending}
              title="Recompute the scorecard and findings from the data already synced"
              onClick={() =>
                rescore.mutate(d.id, {
                  onSuccess: () =>
                    toast({
                      variant: "success",
                      title: "Scorecard recomputed",
                    }),
                })
              }
            >
              <RefreshCw className="size-4" />
              Re-score
            </Button>
          )}
          {canManage && status.data?.keys.pagespeed && (
            <Button
              size="sm"
              variant="outline"
              loading={speed.isPending}
              title="Measure mobile speed and Core Web Vitals now with PageSpeed Insights (takes up to a minute)"
              onClick={() =>
                speed.mutate(d.id, {
                  onSuccess: (r) =>
                    toast(
                      r.errors.length && !r.checked
                        ? {
                            variant: "error",
                            title: "PageSpeed couldn't measure the pages",
                            description: r.errors[0],
                          }
                        : {
                            variant: "success",
                            title: `Speed measured on ${r.checked} page${r.checked === 1 ? "" : "s"}`,
                            description: r.errors[0],
                          },
                    ),
                  onError: (e) =>
                    toast({
                      variant: "error",
                      title: "PageSpeed failed",
                      description: e.messages?.[0] ?? e.message,
                    }),
                })
              }
            >
              <Gauge className="size-4" />
              Check speed
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            title="Open this site as a printable report in a new tab"
            onClick={() =>
              window.open(`/seo-site/${d.id}?print=1`, "_blank", "noopener")
            }
          >
            <Printer className="size-4" />
            PDF report
          </Button>
        </div>
      </div>
      <a
        href={d.homeUrl}
        target="_blank"
        rel="noreferrer"
        className="-mt-2 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        {d.domain}
        <ExternalLink className="size-3.5" />
      </a>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Fact
          label="Health"
          hint="Weighted average of the pillars that have data (draft method). Needs at least 3 pillars."
        >
          <HealthScore score={d.health} size="lg" />
        </Fact>
        <Fact label="Owner">
          {d.owner?.name ?? (
            <span className="text-muted-foreground">Not assigned</span>
          )}
        </Fact>
        <Fact label="Merchant">
          {d.links.merchant ? (
            <Link
              href={`/merchants/${d.links.merchant.id}/overview`}
              className="hover:underline"
            >
              {d.links.merchant.name}
            </Link>
          ) : (
            <span className="text-muted-foreground">Not linked</span>
          )}
        </Fact>
        <Fact label="Search Console">
          {d.gscProperty ? (
            <span className="break-all font-mono text-xs">{d.gscProperty}</span>
          ) : (
            <Badge tone="warning">Not linked</Badge>
          )}
        </Fact>
        <Fact label="GA4">
          {d.ga4Property ? (
            <span className="text-xs">{d.ga4Name ?? d.ga4Property}</span>
          ) : (
            <Badge tone="warning">Not linked</Badge>
          )}
        </Fact>
        <Fact label="Data">
          <span className="flex flex-col text-xs font-normal text-muted-foreground">
            <span>Search Console through {fmtDay(d.sync.gscThrough)}</span>
            <span>Pages checked {fmtAgo(d.sync.lastCrawlAt)}</span>
            {d.sync.lastPsiAt && (
              <span>Speed checked {fmtAgo(d.sync.lastPsiAt)}</span>
            )}
          </span>
        </Fact>
      </div>
      {d.sync.error && (
        <p className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">
          Last sync failed: {d.sync.error}
        </p>
      )}
      {d.sync.warning && !d.sync.error && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Synced with gaps: {d.sync.warning}
        </p>
      )}
    </Card>
  );
}

export function Pillars({ d }: { d: SiteDetail }) {
  const sc = d.score;
  return (
    <Section
      title="Six-pillar scorecard"
      aside={
        <span className="text-xs text-muted-foreground">
          Draft method ({sc?.method ?? "draft-v0"}) · every point comes from
          synced data · targets in KPI Studio
        </span>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {d.pillarMeta.map((m) => {
          const p = sc?.pillars[m.key as PillarKey];
          const g = gradeOf(p?.score);
          return (
            <Card key={m.key} className="flex flex-col gap-3 p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">
                    {m.long}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {m.source} · weight {m.weight}%
                  </div>
                </div>
                {p?.score != null && g ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={cn(
                        "text-xl font-semibold tabular-nums",
                        GRADE[g].text,
                      )}
                    >
                      {p.score}
                    </span>
                    <Badge tone={GRADE[g].tone} icon={false}>
                      {g}
                    </Badge>
                  </span>
                ) : (
                  <Badge tone="neutral" icon={false}>
                    Pending
                  </Badge>
                )}
              </div>
              {p?.score != null && g && (
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", GRADE[g].bar)}
                    style={{ width: `${p.score}%` }}
                  />
                </div>
              )}
              {p?.parts.length ? (
                <ul className="flex flex-col gap-1 text-xs">
                  {p.parts.map((x) => (
                    <li key={x.label} className="flex items-center gap-2">
                      <span
                        className="min-w-0 flex-1 truncate text-muted-foreground"
                        title={x.label}
                      >
                        {x.label}
                      </span>
                      <span className="text-foreground">{x.value}</span>
                      <span className="w-14 text-right tabular-nums text-muted-foreground">
                        {x.points}/{x.max}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {p?.missing && (
                <p className="text-xs text-muted-foreground">{p.missing}</p>
              )}
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

export function Performance({ d }: { d: SiteDetail }) {
  const k = d.kpis;
  const tiles: [string, React.ReactNode, number | null, boolean?][] = [
    ["Clicks", fmtNum(k.clicks), changeOf(k.clicks, k.clicksPrev)],
    [
      "Impressions",
      fmtNum(k.impressions),
      changeOf(k.impressions, k.impressionsPrev),
    ],
    ["CTR", fmtPct1(k.ctr), changeOf(k.ctr, k.ctrPrev)],
    [
      "Avg position",
      k.position ?? "—",
      changeOf(k.position, k.positionPrev),
      true,
    ],
    ["Visits", fmtNum(k.sessions), changeOf(k.sessions, k.sessionsPrev)],
    [
      "Organic visits",
      fmtNum(k.organicSessions),
      changeOf(k.organicSessions, k.organicSessionsPrev),
    ],
    ["Key events", fmtNum(k.keyEvents), changeOf(k.keyEvents, k.keyEventsPrev)],
    [
      "Ranking searches",
      fmtNum(k.rankingSearches),
      changeOf(k.rankingSearches, k.rankingSearchesPrev ?? undefined),
    ],
  ];
  const dates = weekEnds(d.trend.end, d.trend.weeks);
  const series = [
    d.trend.clicks && {
      key: "clicks",
      label: "Search clicks",
      color: "var(--series-1)",
      values: d.trend.clicks,
    },
    d.trend.sessions && {
      key: "sessions",
      label: "Website visits (GA4)",
      color: "var(--series-2)",
      values: d.trend.sessions,
    },
  ].filter(Boolean) as {
    key: string;
    label: string;
    color: string;
    values: number[];
  }[];
  return (
    <Section
      title="Search performance"
      aside={
        <span className="text-xs text-muted-foreground">
          Last 28 days vs the 28 before · Search Console + GA4
          {k.rankingMonth &&
            ` · ranking searches: ${fmtMonthIso(k.rankingMonth)} vs ${fmtMonthIso(k.rankingPrevMonth)}${k.top10Searches != null ? ` (${fmtNum(k.top10Searches)} in the top 10)` : ""}`}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {tiles.map(([label, value, ch, invert]) => (
          <div
            key={label}
            className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {value}
            </span>
            <ChangeText v={ch} invert={invert} />
          </div>
        ))}
      </div>
      <Card className="p-4">
        <div className="mb-2 text-xs text-muted-foreground">
          Weekly, last {d.trend.weeks} weeks
        </div>
        {series.length ? (
          <TrendChart dates={dates} series={series} />
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Connect Search Console or GA4 to see the trend.
          </p>
        )}
      </Card>
    </Section>
  );
}

export function Findings({ d }: { d: SiteDetail }) {
  return (
    <Section
      title="Open findings"
      aside={
        <Link
          href={`/web/seo/intelligence?siteId=${d.id}`}
          className="text-xs font-medium text-primary hover:underline"
        >
          Work them in Intelligence
        </Link>
      }
    >
      <Card>
        {d.findings.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Nothing open for this site.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {d.findings.slice(0, 12).map((f) => (
              <li key={f.id}>
                <Link
                  href={`/web/seo/intelligence?siteId=${d.id}&open=${f.id}`}
                  className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-secondary"
                >
                  <SeverityBadge s={f.severity} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {f.title}
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {f.detail}
                    </span>
                  </span>
                  <StateBadge s={f.state} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {d.findings.length > 12 && (
          <Link
            href={`/web/seo/intelligence?siteId=${d.id}`}
            className="block border-t border-border py-2 text-center text-xs font-medium text-muted-foreground hover:bg-secondary"
          >
            Show all {d.findings.length}
          </Link>
        )}
      </Card>
    </Section>
  );
}

const NAP_TONE = {
  match: { tone: "success", text: "Matches" },
  different: { tone: "danger", text: "Different" },
  not_found: { tone: "warning", text: "Not found on site" },
  no_listing_value: { tone: "outline", text: "Not on listing" },
} as const;

function NapRow({ label, c }: { label: string; c: NapItem }) {
  const t = NAP_TONE[c.state];
  const detail = [
    c.site && `Website: ${c.site}`,
    c.google && `Google: ${c.google}`,
    c.missing && `Not on website: ${c.missing}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex items-start gap-2 text-sm" title={detail || undefined}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-foreground">{label}</span>
        {detail && (
          <span className="truncate text-xs text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      <Badge tone={t.tone} icon={false}>
        {t.text}
      </Badge>
    </div>
  );
}

export function LocalCard({ d }: { d: SiteDetail }) {
  const l = d.local;
  return (
    <Section
      title="Local SEO"
      aside={
        l ? (
          <Link
            href={`/web/gbp/${l.locationId}?range=30d`}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            GBP report <ArrowUpRight className="size-3.5" />
          </Link>
        ) : undefined
      }
    >
      <Card className="flex flex-col gap-3 p-4">
        {!l ? (
          <p className="text-sm text-muted-foreground">
            No Google Business Profile listing linked. Link one in Site settings
            to score the Local SEO pillar.
          </p>
        ) : (
          <>
            <div className="text-sm font-medium text-foreground">{l.title}</div>
            <div className="grid grid-cols-2 gap-3">
              <Fact label="Profile completion">{l.profilePct}%</Fact>
              <Fact label="Verification">
                <Badge
                  tone={l.verification === "verified" ? "success" : "warning"}
                >
                  {l.verification}
                </Badge>
              </Fact>
              <Fact label="Rating">
                {l.rating != null
                  ? `${l.rating.toFixed(1)} (${fmtNum(l.reviews)} reviews)`
                  : "No reviews"}
              </Fact>
              <Fact label="Website on listing">
                {l.websiteMatches ? (
                  <Badge tone="success">Matches</Badge>
                ) : (
                  <Badge tone="warning">
                    {l.websiteUrl ? "Points elsewhere" : "Missing"}
                  </Badge>
                )}
              </Fact>
            </div>
            {l.actions && (
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["Calls", l.actions.calls, l.actions.callsPrev],
                    [
                      "Directions",
                      l.actions.directions,
                      l.actions.directionsPrev,
                    ],
                    ["Website", l.actions.website, l.actions.websitePrev],
                  ] as const
                ).map(([label, v, p]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-border px-2.5 py-2"
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {label}
                    </div>
                    <div className="text-base font-semibold tabular-nums text-foreground">
                      {fmtNum(v)}
                    </div>
                    <ChangeText v={changeOf(v, p)} />
                  </div>
                ))}
              </div>
            )}
            {l.missingFields.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Missing on the listing: {l.missingFields.join(", ")}.
              </p>
            )}
          </>
        )}
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          {d.sfExtras.napCheck ? (
            (
              [
                ["Phone on website matches Google", d.sfExtras.napCheck.phone],
                [
                  "Address on website matches Google",
                  d.sfExtras.napCheck.address,
                ],
                [
                  "Opening hours on website match Google",
                  d.sfExtras.napCheck.hours,
                ],
              ] as const
            ).map(([label, c]) => <NapRow key={label} label={label} c={c} />)
          ) : d.sfExtras.nap && d.sfExtras.nap.extractors.length > 0 ? (
            <WebsiteNap nap={d.sfExtras.nap} crawledAt={d.sfExtras.crawledAt} />
          ) : (
            <div
              className="flex items-center gap-2 text-sm"
              title="Add Phone, Street and Hours extractors in Screaming Frog (Configuration → Custom → Extraction) and export Custom Extraction:All"
            >
              <span className="flex-1 text-muted-foreground">
                Phone, address &amp; hours on website match Google
              </span>
              <Badge tone="outline" icon={false}>
                Pending
              </Badge>
            </div>
          )}
          {[
            [
              "NAP consistency across directories",
              "Needs a directory-listings source (not in Screaming Frog)",
            ],
            [
              "Citations",
              "Live / missing directory listings — needs a listings source",
            ],
          ].map(([label, why]) => (
            <div
              key={label}
              className="flex items-center gap-2 text-sm"
              title={why}
            >
              <span className="flex-1 text-muted-foreground">{label}</span>
              <Badge tone="outline" icon={false}>
                Pending
              </Badge>
            </div>
          ))}
        </div>
      </Card>
    </Section>
  );
}

export function Queries({ d }: { d: SiteDetail }) {
  const q = d.queries;
  return (
    <Section
      title="Top Google searches"
      aside={
        <span className="text-xs text-muted-foreground">
          {q.month
            ? `${fmtMonthIso(q.month)} vs ${fmtMonthIso(q.prevMonth)}`
            : "Search Console"}
        </span>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Search term</TableHead>
            <TableHead align="right">Clicks</TableHead>
            <TableHead align="right">Prev.</TableHead>
            <TableHead align="right">Position</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.rows.map((r) => (
            <TableRow key={r.query}>
              <TableCell className="max-w-64 truncate">{r.query}</TableCell>
              <TableCell align="right">{fmtNum(r.clicks)}</TableCell>
              <TableCell align="right" className="text-muted-foreground">
                {fmtNum(r.prevClicks)}
              </TableCell>
              <TableCell align="right">
                {r.position?.toFixed(1) ?? "—"}
              </TableCell>
            </TableRow>
          ))}
          {q.rows.length === 0 && (
            <TableMessageRow colSpan={4}>
              <p className="py-4 text-center text-sm text-muted-foreground">
                No Search Console data yet.
              </p>
            </TableMessageRow>
          )}
        </TableBody>
      </Table>
    </Section>
  );
}

export function TopPages({ d }: { d: SiteDetail }) {
  return (
    <Section
      title="Top landing pages"
      aside={
        <Link
          href={`/web/seo/sites/${d.id}/pages`}
          className="text-xs font-medium text-primary hover:underline"
        >
          All pages
        </Link>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Page</TableHead>
            <TableHead align="right">Clicks</TableHead>
            <TableHead align="right">Impressions</TableHead>
            <TableHead align="right">Position</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.topPages.map((p, i) => (
            <TableRow key={`${i}-${p.url}`}>
              <TableCell
                className="max-w-64 truncate font-mono text-xs"
                title={p.url}
              >
                {p.path}
              </TableCell>
              <TableCell align="right">{fmtNum(p.clicks)}</TableCell>
              <TableCell align="right">{fmtNum(p.impressions)}</TableCell>
              <TableCell align="right">{p.position ?? "—"}</TableCell>
            </TableRow>
          ))}
          {d.topPages.length === 0 && (
            <TableMessageRow colSpan={4}>
              <p className="py-4 text-center text-sm text-muted-foreground">
                No Search Console data yet.
              </p>
            </TableMessageRow>
          )}
        </TableBody>
      </Table>
    </Section>
  );
}

function Keywords({ d, canManage }: { d: SiteDetail; canManage: boolean }) {
  const add = useAddKeyword();
  const del = useDeleteKeyword();
  const { toast } = useToast();
  const [kw, setKw] = useState("");
  const { month, prevMonth } = d.keywordMonths;
  const fmtPos = (v: number | null) => (v == null ? null : v.toFixed(1));
  return (
    <Section
      title="Tracked keywords"
      aside={
        <span className="text-xs text-muted-foreground">
          Average Google position from Search Console
          {month ? ` · ${fmtMonthIso(month)} vs ${fmtMonthIso(prevMonth)}` : ""}
        </span>
      }
    >
      {canManage && (
        <form
          className="flex max-w-md gap-2 print:hidden"
          onSubmit={(e) => {
            e.preventDefault();
            if (kw.trim().length < 2) return;
            add.mutate(
              { siteId: d.id, keyword: kw.trim() },
              {
                onSuccess: () => {
                  setKw("");
                  toast({
                    variant: "success",
                    title: "Keyword added",
                    description:
                      "Its Search Console figures fill in on the next SEO refresh.",
                  });
                },
                onError: (er) =>
                  toast({
                    variant: "error",
                    title: "Couldn't add",
                    description: er.messages?.[0] ?? er.message,
                  }),
              },
            );
          }}
        >
          <Input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="Add a keyword, e.g. best biryani in fremont"
            aria-label="Keyword"
          />
          <Button type="submit" variant="outline" loading={add.isPending}>
            <Plus className="size-4" />
            Track
          </Button>
        </form>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Keyword</TableHead>
            <TableHead align="right">Avg position</TableHead>
            <TableHead align="right">Previous month</TableHead>
            <TableHead align="right">Clicks</TableHead>
            <TableHead align="right">Impressions</TableHead>
            {canManage && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.keywords.map((k) => {
            // Lower is better: a smaller position than last month is an improvement.
            const moved =
              k.position != null && k.previous != null
                ? Math.round((k.previous - k.position) * 10) / 10
                : null;
            return (
              <TableRow key={k.id}>
                <TableCell>
                  {k.keyword}
                  {k.source === "gsc" && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      top search term
                    </span>
                  )}
                </TableCell>
                <TableCell align="right" className="font-medium tabular-nums">
                  {fmtPos(k.position) ?? (
                    <span className="font-normal text-muted-foreground">
                      {month ? "Not showing" : "No data yet"}
                    </span>
                  )}
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  {k.hasPrevious ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-muted-foreground">
                        {fmtPos(k.previous) ?? "—"}
                      </span>
                      {moved != null && moved !== 0 && (
                        <span
                          className={cn(
                            "text-xs",
                            moved > 0
                              ? "text-success-subtle-foreground"
                              : "text-text-destructive",
                          )}
                        >
                          {moved > 0 ? `▲${moved}` : `▼${-moved}`}
                        </span>
                      )}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  {fmtNum(k.clicks)}
                </TableCell>
                <TableCell
                  align="right"
                  className="tabular-nums text-muted-foreground"
                >
                  {fmtNum(k.impressions)}
                </TableCell>
                {canManage && (
                  <TableCell>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Stop tracking ${k.keyword}`}
                      onClick={() => del.mutate(k.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
          {d.keywords.length === 0 && (
            <TableMessageRow colSpan={canManage ? 6 : 5}>
              <p className="py-4 text-center text-sm text-muted-foreground">
                No keywords tracked. The first Search Console sync starts
                tracking the site&apos;s top search terms.
              </p>
            </TableMessageRow>
          )}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Average position across every Google search for that term, for the whole
        month (Search Console). &quot;Not showing&quot; means the site
        didn&apos;t appear for it that month.
      </p>
    </Section>
  );
}

function Reports({ d }: { d: SiteDetail }) {
  const router = useRouter();
  const gen = useGenerateReport();
  const { toast } = useToast();
  const pg = usePager(d.reports);
  return (
    <Section
      title="Reports & schedule"
      aside={
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {cadenceLabel(d.reportCadence)} · next:{" "}
          {fmtRange(d.nextReport.periodStart, d.nextReport.periodEnd)}, due{" "}
          {fmtDay(d.nextReport.due)}
          <Button
            size="sm"
            variant="outline"
            className="print:hidden"
            loading={gen.isPending}
            onClick={() =>
              gen.mutate(
                { siteId: d.id },
                {
                  onSuccess: (r) => router.push(`/web/seo/reports/${r.id}`),
                  onError: (e) =>
                    toast({
                      variant: "error",
                      title: "Couldn't assemble the report",
                      description: e.messages?.[0] ?? e.message,
                    }),
                },
              )
            }
          >
            <FileChartColumn className="size-4" />
            Compose report
          </Button>
        </span>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Assembled</TableHead>
            <TableHead>Sent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pg.rows.map((r) => (
            <TableRow
              key={r.id}
              interactive
              onClick={() => router.push(`/web/seo/reports/${r.id}`)}
            >
              <TableCell className="font-medium">
                {r.label ?? fmtRange(r.periodStart, r.periodEnd)}
              </TableCell>
              <TableCell>
                <ReportStatusBadge s={r.status} />
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {fmtDay(r.generatedAt.slice(0, 10))} ·{" "}
                {r.auto ? "automatically" : "by hand"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {r.sentAt ? fmtDay(r.sentAt.slice(0, 10)) : "—"}
              </TableCell>
            </TableRow>
          ))}
          {d.reports.length === 0 && (
            <TableMessageRow colSpan={4}>
              <p className="py-4 text-center text-sm text-muted-foreground">
                No reports yet. The daily sync assembles the due report once the
                period&apos;s data is in.
              </p>
            </TableMessageRow>
          )}
        </TableBody>
      </Table>
      {pg.bar}
    </Section>
  );
}

function Pending({ d }: { d: SiteDetail }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[repeat(2,minmax(0,1fr))]">
      <Section title="Not measured yet">
        <Card className="flex flex-col gap-2 p-4">
          <div className="text-sm font-semibold text-foreground">
            {d.sfExtras.linkMetrics
              ? "Link data & planned data"
              : "Planned data (placeholder)"}
          </div>
          <ul className="flex flex-col gap-1.5">
            {d.sfExtras.linkMetrics && (
              <BacklinksRow
                lm={d.sfExtras.linkMetrics}
                crawledAt={d.sfExtras.crawledAt}
              />
            )}
            {d.placeholders
              .filter((p) => !(p.key === "backlinks" && d.sfExtras.linkMetrics))
              .map((p) => (
                <li key={p.key} className="flex items-center gap-2 text-sm">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-foreground">{p.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.key === "backlinks" && d.sfExtras.crawledAt
                        ? `Crawl of ${fmtDay(d.sfExtras.crawledAt.slice(0, 10))} had no link data — connect a Moz, Majestic or Ahrefs API key in Screaming Frog (Configuration → API Access)`
                        : p.source}
                    </span>
                  </span>
                  <Badge tone="outline" icon={false}>
                    Pending
                  </Badge>
                </li>
              ))}
          </ul>
          <InfoNote>
            Backlinks come from Screaming Frog once a link-data API (Ahrefs,
            Majestic or Moz) is connected inside it. Competitors and citations
            need their own source. Until then they stay empty — never estimated.
          </InfoNote>
          <Link
            href={`/web/seo/sites/${d.id}/pages`}
            className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <Construction className="size-3.5" />
            Page editor preview (pick a page → Edit)
          </Link>
        </Card>
      </Section>
    </div>
  );
}

function BacklinksRow({
  lm,
  crawledAt,
}: {
  lm: NonNullable<SiteDetail["sfExtras"]["linkMetrics"]>;
  crawledAt: string | null;
}) {
  const bits = [
    lm.authority != null && `${lm.authorityLabel} ${lm.authority}`,
    lm.referringDomains != null &&
      `${fmtNum(lm.referringDomains)} referring domains`,
    lm.backlinks != null && `${fmtNum(lm.backlinks)} backlinks`,
  ].filter(Boolean);
  const top = lm.top
    .slice(0, 3)
    .map(
      (t) => `${t.path} (${fmtNum(t.referringDomains ?? t.backlinks ?? 0)})`,
    );
  return (
    <li
      className="flex items-start gap-2 text-sm"
      title={top.length ? `Most-linked pages: ${top.join(", ")}` : undefined}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-foreground">Backlinks &amp; authority</span>
        <span className="text-xs text-muted-foreground">
          {bits.join(" · ") || "No link data returned"} — {lm.provider} via
          Screaming Frog{crawledAt ? `, ${fmtDay(crawledAt.slice(0, 10))}` : ""}
        </span>
      </span>
      <Badge tone="success" icon={false}>
        Measured
      </Badge>
    </li>
  );
}

/** What the website itself shows (Screaming Frog custom extraction) when there's no Google listing to compare with. */
function WebsiteNap({
  nap,
  crawledAt,
}: {
  nap: NonNullable<SiteDetail["sfExtras"]["nap"]>;
  crawledAt: string | null;
}) {
  const uniq = (xs: string[]) => [
    ...new Set(xs.map((x) => x.trim()).filter(Boolean)),
  ];
  const rows: [string, string[]][] = [
    ["Phone on website", uniq(nap.phones.map((p) => p.value))],
    ["Address on website", uniq(nap.streets.map((s) => s.value))],
    ["Opening hours on website", uniq(nap.hours.map((h) => h.value))],
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs text-muted-foreground">
        From the Screaming Frog crawl
        {crawledAt ? ` of ${fmtDay(crawledAt.slice(0, 10))}` : ""} · link a
        Google Business Profile listing to check them against Google
      </div>
      {rows.map(([label, vals]) => (
        <div key={label} className="flex items-start gap-2 text-sm">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-foreground">{label}</span>
            <span
              className="text-xs text-muted-foreground"
              title={vals.join("\n")}
            >
              {vals.length
                ? vals.slice(0, 3).join(" · ") +
                  (vals.length > 3 ? ` +${vals.length - 3} more` : "")
                : "Not found on the website"}
            </span>
          </span>
          <Badge tone={vals.length ? "success" : "warning"} icon={false}>
            {vals.length ? "Found" : "Not found"}
          </Badge>
        </div>
      ))}
    </div>
  );
}
