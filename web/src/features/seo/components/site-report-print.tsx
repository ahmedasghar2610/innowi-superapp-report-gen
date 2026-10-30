"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { Button, ErrorState, Skeleton } from "@/components/ui";
import { TrendChart } from "@/features/gbp/components/trend-chart";
import { cn } from "@/lib/utils/cn";
import { useSeoSite, useSiteCrawl } from "../api";
import {
  changeOf,
  fmtChange,
  fmtDay,
  fmtMonthIso,
  fmtNum,
  fmtPct1,
  GRADE,
  gradeOf,
  SEVERITY,
  STATE,
  weekEnds,
} from "../lib";
import type { CrawlOverview, PillarKey, SiteDetail } from "../types";
import { DemoBadge, PackageBadge } from "./parts";

/**
 * /seo-site/[siteId] — the site scorecard as a printable report (the site
 * page's "PDF" button). Outside the app shell; `?print=1` opens the print
 * dialog once the data has loaded. Read-only, real data only — no
 * placeholders, no buttons inside the document.
 */
export function SiteReportPrintPage({ id }: { id: string }) {
  const q = useSeoSite(id);
  const crawl = useSiteCrawl(id);
  const d = q.data;
  const autoPrint = useSearchParams().get("print") === "1";
  const printed = useRef(false);
  const ready = !!d && !crawl.isLoading;

  useEffect(() => {
    if (d?.name)
      document.title = `${d.name} — SEO site report — ${new Date().toISOString().slice(0, 10)}`;
  }, [d?.name]);
  useEffect(() => {
    if (ready && autoPrint && !printed.current) {
      printed.current = true;
      const t = setTimeout(() => window.print(), 800); // let the chart measure itself first
      return () => clearTimeout(t);
    }
  }, [ready, autoPrint]);

  return (
    <div className="min-h-dvh bg-muted/40 print:bg-white">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-[920px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <Link
            href={`/web/seo/sites/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to site
          </Link>
          <span className="text-sm font-semibold text-foreground">
            Site report
          </span>
          {d && (
            <span className="truncate text-sm text-muted-foreground">
              {d.name}
            </span>
          )}
          {d?.isDemo && <DemoBadge />}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => window.print()}
            disabled={!ready}
          >
            <Printer className="size-4" />
            Print / Save as PDF
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-[920px] px-4 py-6 print:max-w-none print:p-0">
        {q.error ? (
          <ErrorState
            title="Couldn't load this site"
            description={q.error.message}
          />
        ) : !ready ? (
          <Skeleton className="h-[40rem] w-full" />
        ) : (
          <SiteReport d={d} crawl={crawl.data ?? null} />
        )}
      </main>
    </div>
  );
}

function SiteReport({
  d,
  crawl,
}: {
  d: SiteDetail;
  crawl: CrawlOverview | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const g = gradeOf(d.health);
  return (
    <article className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-sm print:rounded-none print:border-0 print:shadow-none">
      {/* Brand band */}
      <header className="flex items-center gap-3 bg-slate-900 px-7 py-5 text-white">
        <span
          className="size-2.5 rounded-full bg-orange-500 ring-4 ring-orange-500/30"
          aria-hidden
        />
        <span className="text-lg font-bold tracking-tight">innowi</span>
        <span className="text-xs text-slate-400">SEO Site Report</span>
        <div className="ml-auto text-right text-[11px] text-slate-400">
          Prepared
          <b className="block text-[13px] text-white">{fmtDay(today)}</b>
        </div>
      </header>

      {/* Cover: who + headline score */}
      <div className="grid gap-5 border-b border-border px-7 py-5 sm:grid-cols-[minmax(0,1fr)_auto] print:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">
              {d.name}
            </h1>
            <PackageBadge p={d.package} />
            {d.isDemo && <DemoBadge />}
          </div>
          <div className="text-sm text-muted-foreground">{d.domain}</div>
          <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <Meta k="Merchant" v={d.links.merchant?.name ?? "Not linked"} />
            <Meta k="Account owner" v={d.owner?.name ?? "Not assigned"} />
            <Meta k="Search Console" v={d.gscProperty ?? "Not linked"} />
            <Meta
              k="GA4"
              v={d.ga4Property ? (d.ga4Name ?? d.ga4Property) : "Not linked"}
            />
            <Meta k="Search data through" v={fmtDay(d.sync.gscThrough)} />
            <Meta
              k="Google Business Profile"
              v={d.links.gbpLocation?.title ?? "Not linked"}
            />
          </dl>
        </div>
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-border px-6 py-4 text-center">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            SEO health
          </span>
          <span
            className={cn(
              "text-5xl font-semibold tabular-nums leading-none",
              g ? GRADE[g].text : "text-muted-foreground",
            )}
          >
            {d.health ?? "—"}
          </span>
          <span className="text-sm font-medium text-muted-foreground">
            {g ? `Grade ${g}` : "Not enough data"}
          </span>
          <span className="text-[11px] text-muted-foreground">
            out of 100 · six-pillar weighted
          </span>
        </div>
      </div>

      <div className="flex flex-col px-7 pb-4">
        <Summary d={d} crawl={crawl} />
        <Scorecard d={d} />
        <Performance d={d} />
        <Findings d={d} />
        {crawl?.crawl && <Crawl c={crawl} />}
        <Local d={d} />
        <SearchesAndPages d={d} />
        {d.keywords.length > 0 && <Keywords d={d} />}
      </div>

      <footer className="border-t border-border bg-muted/40 px-7 py-3 text-[11px] leading-5 text-muted-foreground">
        Sources: Google Search Console, Google Analytics 4, Google Business
        Profile, PageSpeed Insights
        {crawl?.crawl ? ", Screaming Frog crawl" : ""}. Search figures compare
        the last 28 days with the 28 days before. Scorecard method{" "}
        {d.score?.method ?? "draft-v0"}. Prepared by Innowi.
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------ sections ---- */

function Summary({ d, crawl }: { d: SiteDetail; crawl: CrawlOverview | null }) {
  const k = d.kpis;
  const lines: string[] = [];
  const g = gradeOf(d.health);
  if (d.health != null)
    lines.push(`Overall SEO health is ${d.health}/100 (grade ${g}).`);
  const pillars = d.pillarMeta
    .map((m) => ({ m, s: d.score?.pillars[m.key as PillarKey]?.score }))
    .filter(
      (x): x is { m: (typeof d.pillarMeta)[number]; s: number } => x.s != null,
    )
    .sort((a, b) => a.s - b.s);
  if (pillars.length > 1)
    lines.push(
      `Strongest area: ${pillars[pillars.length - 1].m.long} (${pillars[pillars.length - 1].s}). Weakest: ${pillars[0].m.long} (${pillars[0].s}).`,
    );
  const ch = changeOf(k.clicks, k.clicksPrev);
  if (k.clicks != null)
    lines.push(
      `Google search brought ${fmtNum(k.clicks)} clicks in the last 28 days${ch != null ? ` (${fmtChange(ch)} vs the 28 days before)` : ""}, from ${fmtNum(k.impressions)} times the site was shown.`,
    );
  if (k.sessions != null)
    lines.push(
      `The website had ${fmtNum(k.sessions)} visits, ${fmtNum(k.organicSessions)} of them from search.`,
    );
  const open = d.findings.filter((f) => f.state !== "closed");
  if (open.length) {
    const s1 = open.filter((f) => f.severity === "S1").length;
    lines.push(
      `${open.length} open finding${open.length === 1 ? "" : "s"}${s1 ? `, ${s1} urgent (S1)` : ""}.`,
    );
  }
  const t = crawl?.crawl?.totals;
  if (t)
    lines.push(
      `Full-site crawl: ${fmtNum(t.html)} pages checked, ${fmtNum(t.errors4xx + t.errors5xx)} broken, ${t.issuesWithUrls} issue types found.`,
    );
  if (!lines.length) return null;
  return (
    <DocSection title="Summary">
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-6 text-foreground">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </DocSection>
  );
}

function Scorecard({ d }: { d: SiteDetail }) {
  return (
    <DocSection title="Six-pillar scorecard">
      <table className="w-full text-sm">
        <thead>
          <Th
            cols={["Pillar", "Source", "Weight", "Score", ""]}
            right={[2, 3]}
          />
        </thead>
        <tbody>
          {d.pillarMeta.map((m) => {
            const p = d.score?.pillars[m.key as PillarKey];
            const g = gradeOf(p?.score);
            return (
              <tr key={m.key} className="border-b border-border/60 align-top">
                <td className="py-2 pr-3">
                  <div className="font-medium text-foreground">{m.long}</div>
                  {p?.missing && (
                    <div className="text-xs text-muted-foreground">
                      {p.missing}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-muted-foreground">
                  {m.source}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                  {m.weight}%
                </td>
                <td className="py-2 pr-3 text-right">
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      g ? GRADE[g].text : "text-muted-foreground",
                    )}
                  >
                    {p?.score ?? "—"}
                  </span>
                  {g && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {g}
                    </span>
                  )}
                </td>
                <td className="w-36 py-3">
                  <span className="block h-2 overflow-hidden rounded-full bg-muted">
                    {p?.score != null && g && (
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          GRADE[g].bar,
                        )}
                        style={{ width: `${p.score}%` }}
                      />
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DocSection>
  );
}

function Performance({ d }: { d: SiteDetail }) {
  const k = d.kpis;
  const rows: [string, string, string, number | null, boolean?][] = [
    [
      "Search clicks",
      fmtNum(k.clicks),
      fmtNum(k.clicksPrev),
      changeOf(k.clicks, k.clicksPrev),
    ],
    [
      "Times shown in Google",
      fmtNum(k.impressions),
      fmtNum(k.impressionsPrev),
      changeOf(k.impressions, k.impressionsPrev),
    ],
    [
      "Click-through rate",
      fmtPct1(k.ctr),
      fmtPct1(k.ctrPrev),
      changeOf(k.ctr, k.ctrPrev),
    ],
    [
      "Average position",
      k.position != null ? String(k.position) : "—",
      k.positionPrev != null ? String(k.positionPrev) : "—",
      changeOf(k.position, k.positionPrev),
      true,
    ],
    [
      "Website visits",
      fmtNum(k.sessions),
      fmtNum(k.sessionsPrev),
      changeOf(k.sessions, k.sessionsPrev),
    ],
    [
      "Visits from search",
      fmtNum(k.organicSessions),
      fmtNum(k.organicSessionsPrev),
      changeOf(k.organicSessions, k.organicSessionsPrev),
    ],
    [
      "Key events",
      fmtNum(k.keyEvents),
      fmtNum(k.keyEventsPrev),
      changeOf(k.keyEvents, k.keyEventsPrev),
    ],
    [
      "Searches the site shows up for",
      fmtNum(k.rankingSearches),
      fmtNum(k.rankingSearchesPrev),
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
    <DocSection
      title="Search performance"
      aside="Last 28 days vs the 28 days before"
    >
      <table className="w-full text-sm">
        <thead>
          <Th
            cols={["Metric", "Last 28 days", "Previous 28 days", "Change"]}
            right={[1, 2, 3]}
          />
        </thead>
        <tbody>
          {rows.map(([label, now, prev, ch, invert]) => (
            <tr key={label} className="border-b border-border/60">
              <td className="py-1.5 text-foreground">{label}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums">
                {now}
              </td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {prev}
              </td>
              <td
                className={cn(
                  "py-1.5 text-right tabular-nums",
                  tone(ch, invert),
                )}
              >
                {fmtChange(ch)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {series.length > 0 && (
        <div className="mt-3 rounded-lg border border-border p-3">
          <div className="mb-1 text-xs text-muted-foreground">
            Weekly, last {d.trend.weeks} weeks
          </div>
          <TrendChart dates={dates} series={series} />
        </div>
      )}
    </DocSection>
  );
}

function Findings({ d }: { d: SiteDetail }) {
  const open = d.findings.filter((f) => f.state !== "closed");
  return (
    <DocSection
      title="Open findings & recommendations"
      aside={open.length ? `${open.length} open` : undefined}
    >
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing open for this site.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <Th cols={["Priority", "Finding", "What to do", "Status"]} />
          </thead>
          <tbody>
            {open.slice(0, 25).map((f) => (
              <tr key={f.id} className="border-b border-border/60 align-top">
                <td className="py-2 pr-3">
                  <SevDot s={f.severity} />
                </td>
                <td className="py-2 pr-3">
                  <div className="font-medium text-foreground">{f.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {f.detail}
                  </div>
                </td>
                <td className="py-2 pr-3 text-xs text-foreground">
                  {f.recommendation || "—"}
                </td>
                <td className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                  {STATE[f.state].label}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open.length > 25 && (
        <Note>Showing the 25 highest-priority findings of {open.length}.</Note>
      )}
      <Note>
        S1 — act the same business day · S2 — within 48 hours · S3 — within a
        week.
      </Note>
    </DocSection>
  );
}

function Crawl({ c }: { c: CrawlOverview }) {
  const t = c.crawl!.totals;
  const top = c.issues.filter((i) => i.urls > 0).slice(0, 10);
  return (
    <DocSection
      title="Technical check — full-site crawl"
      aside={`Screaming Frog · ${fmtDay((c.crawl!.crawledAt ?? c.crawl!.importedAt).slice(0, 10))}`}
    >
      <div className="grid grid-cols-3 gap-2.5 md:grid-cols-6 print:grid-cols-6">
        <Tile
          label="Pages"
          value={fmtNum(t.html)}
          sub={`${fmtNum(t.indexable)} indexable`}
        />
        <Tile
          label="Non-indexable"
          value={fmtNum(t.nonIndexable)}
          bad={t.nonIndexable > 0}
        />
        <Tile
          label="Broken"
          value={fmtNum(t.errors4xx + t.errors5xx)}
          bad={t.errors4xx + t.errors5xx > 0}
          sub="4xx / 5xx"
        />
        <Tile
          label="Redirects"
          value={fmtNum(t.redirects)}
          sub={t.redirectChains ? `${t.redirectChains} chains` : "no chains"}
        />
        <Tile
          label="Orphan pages"
          value={fmtNum(t.orphans)}
          bad={!!t.orphans}
        />
        <Tile
          label="Words / page"
          value={fmtNum(t.avgWords)}
          sub={`${fmtNum(t.avgResponseMs)} ms response`}
        />
      </div>
      {top.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead>
            <Th
              cols={["Priority", "Issue", "Pages affected", "How to fix"]}
              right={[2]}
            />
          </thead>
          <tbody>
            {top.map((i) => (
              <tr key={i.key} className="border-b border-border/60 align-top">
                <td className="py-1.5 pr-3 text-xs font-medium">
                  {i.priority}
                </td>
                <td className="py-1.5 pr-3 text-foreground">{i.name}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {fmtNum(i.urls)}
                </td>
                <td className="py-1.5 text-xs text-muted-foreground">
                  {i.howToFix ? clip(i.howToFix, 160) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Note>
        {t.issuesWithUrls} issue types found ({t.issueTypes.High ?? 0} high ·{" "}
        {t.issueTypes.Medium ?? 0} medium · {t.issueTypes.Low ?? 0} low
        priority).
      </Note>
    </DocSection>
  );
}

function Local({ d }: { d: SiteDetail }) {
  const l = d.local;
  if (!l) return null;
  const a = l.actions;
  return (
    <DocSection title="Local SEO — Google Business Profile" aside={l.title}>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 print:grid-cols-4">
        <Tile label="Profile complete" value={`${l.profilePct}%`} />
        <Tile
          label="Verification"
          value={l.verification}
          bad={l.verification !== "verified"}
        />
        <Tile
          label="Rating"
          value={l.rating != null ? l.rating.toFixed(1) : "—"}
          sub={
            l.reviews != null ? `${fmtNum(l.reviews)} reviews` : "no reviews"
          }
        />
        <Tile
          label="Website on listing"
          value={
            l.websiteMatches
              ? "Matches"
              : l.websiteUrl
                ? "Points elsewhere"
                : "Missing"
          }
          bad={!l.websiteMatches}
        />
      </div>
      {a && (
        <table className="mt-3 w-full text-sm">
          <thead>
            <Th
              cols={["Customer action", "This period", "Previous", "Change"]}
              right={[1, 2, 3]}
            />
          </thead>
          <tbody>
            {(
              [
                ["Calls", a.calls, a.callsPrev],
                ["Direction requests", a.directions, a.directionsPrev],
                ["Website clicks", a.website, a.websitePrev],
              ] as const
            ).map(([label, v, p]) => {
              const ch = changeOf(v, p);
              return (
                <tr key={label} className="border-b border-border/60">
                  <td className="py-1.5">{label}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">
                    {fmtNum(v)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {fmtNum(p)}
                  </td>
                  <td
                    className={cn("py-1.5 text-right tabular-nums", tone(ch))}
                  >
                    {fmtChange(ch)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {l.missingFields.length > 0 && (
        <Note>Missing on the listing: {l.missingFields.join(", ")}.</Note>
      )}
    </DocSection>
  );
}

function SearchesAndPages({ d }: { d: SiteDetail }) {
  const q = d.queries;
  if (!q.rows.length && !d.topPages.length) return null;
  return (
    <div className="grid gap-x-6 md:grid-cols-2 print:grid-cols-2">
      {q.rows.length > 0 && (
        <DocSection
          title="Top Google searches"
          aside={q.month ? fmtMonthIso(q.month) : undefined}
        >
          <table className="w-full text-sm">
            <thead>
              <Th cols={["Search term", "Clicks", "Pos."]} right={[1, 2]} />
            </thead>
            <tbody>
              {q.rows.slice(0, 10).map((r) => (
                <tr key={r.query} className="border-b border-border/60">
                  <td className="max-w-0 truncate py-1.5 pr-2" title={r.query}>
                    {r.query}
                  </td>
                  <td className="w-14 py-1.5 text-right font-semibold tabular-nums">
                    {fmtNum(r.clicks)}
                  </td>
                  <td className="w-12 py-1.5 text-right tabular-nums text-muted-foreground">
                    {r.position?.toFixed(1) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DocSection>
      )}
      {d.topPages.length > 0 && (
        <DocSection title="Top landing pages" aside="last 28 days">
          <table className="w-full text-sm">
            <thead>
              <Th cols={["Page", "Clicks", "Pos."]} right={[1, 2]} />
            </thead>
            <tbody>
              {d.topPages.slice(0, 10).map((p, i) => (
                <tr key={`${i}-${p.url}`} className="border-b border-border/60">
                  <td
                    className="max-w-0 truncate py-1.5 pr-2 font-mono text-xs"
                    title={p.url}
                  >
                    {p.path}
                  </td>
                  <td className="w-14 py-1.5 text-right font-semibold tabular-nums">
                    {fmtNum(p.clicks)}
                  </td>
                  <td className="w-12 py-1.5 text-right tabular-nums text-muted-foreground">
                    {p.position ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DocSection>
      )}
    </div>
  );
}

function Keywords({ d }: { d: SiteDetail }) {
  return (
    <DocSection
      title="Tracked keywords"
      aside={`Average Google position · Search Console${d.keywordMonths.month ? ` · ${fmtMonthIso(d.keywordMonths.month)} vs ${fmtMonthIso(d.keywordMonths.prevMonth)}` : ""}`}
    >
      <table className="w-full text-sm">
        <thead>
          <Th
            cols={["Keyword", "Avg position", "Previous month", "Clicks"]}
            right={[1, 2, 3]}
          />
        </thead>
        <tbody>
          {d.keywords.slice(0, 20).map((k) => (
            <tr key={k.id} className="border-b border-border/60">
              <td className="py-1.5 pr-3">{k.keyword}</td>
              <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">
                {k.position != null ? k.position.toFixed(1) : "Not showing"}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                {k.hasPrevious && k.previous != null
                  ? k.previous.toFixed(1)
                  : "—"}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {fmtNum(k.clicks)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DocSection>
  );
}

/* ------------------------------------------------------------ pieces ---- */

function DocSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 border-b border-border py-5 last:border-b-0">
      <div className="flex items-baseline gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-foreground">
          {title}
        </h3>
        {aside && (
          <span className="ml-auto truncate text-xs text-muted-foreground">
            {aside}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Th({ cols, right = [] }: { cols: string[]; right?: number[] }) {
  return (
    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
      {cols.map((c, i) => (
        <th
          key={i}
          className={cn(
            "py-1.5 pr-3 font-semibold last:pr-0",
            right.includes(i) && "text-right",
          )}
        >
          {c}
        </th>
      ))}
    </tr>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {k}
      </dt>
      <dd className="truncate text-foreground" title={v}>
        {v}
      </dd>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  bad,
}: {
  label: string;
  value: string;
  sub?: string;
  bad?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-base font-semibold capitalize tabular-nums",
          bad ? "text-text-destructive" : "text-foreground",
        )}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function SevDot({ s }: { s: keyof typeof SEVERITY }) {
  const color =
    s === "S1"
      ? "bg-destructive"
      : s === "S2"
        ? "bg-warning"
        : "bg-muted-foreground";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-semibold"
      title={SEVERITY[s].hint}
    >
      <span className={cn("size-2 rounded-full", color)} aria-hidden />
      {SEVERITY[s].label}
    </span>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function tone(ch: number | null, invert = false) {
  if (ch == null || ch === 0) return "text-muted-foreground";
  return ch > 0 !== invert
    ? "text-success-subtle-foreground"
    : "text-text-destructive";
}

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
