"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Pencil, Plus, RefreshCw, X } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
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
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useBlogImpact, useBlogSites, useBlogStatus, useRefreshBlogs, useSaveBlogSchedule, useSaveBrandTerms, useSeoStatus } from "../api";
import { downloadCsv, fmtAgo, fmtDateTime, fmtDay, fmtNum, fmtRange, fmtShort } from "../lib";
import type { BlogImpact, BlogPostRow, BlogSchedule, BlogStatus } from "../types";
import { usePager } from "./pager";
import { HeadHint, InfoNote, Section } from "./parts";

const PERIODS = [28, 90] as const;

/**
 * /web/seo/blogs — Blog Impact: how each site's blog posts do in Search Console and GA4.
 * Posts are found on the live site (WordPress feed, post sitemap or crawled pages); this page
 * never reads the blog-writing workflow. Impact numbers use final Search Console days only.
 */
export function BlogImpactPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const seoStatus = useSeoStatus();
  const status = useBlogStatus();
  const sites = useBlogSites();
  const canManage = !!seoStatus.data?.canManage;

  const days = Number(params.get("days")) === 90 ? 90 : 28;
  // US only unless the link says ?country=all (the restaurants' customers are in the US).
  const country: "all" | "us" = params.get("country") === "all" ? "all" : "us";
  const siteId = params.get("site") ?? sites.data?.[0]?.id ?? null;
  const impact = useBlogImpact(siteId, days, country);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  if (status.error) return <ErrorState title="Couldn't load Blog Impact" description={status.error.message} />;
  if (!status.data || !sites.data) return <Skeleton className="h-96 w-full" />;

  return (
    <>
      <ScheduleBar status={status.data} canManage={canManage} />

      {!status.data.connected ? (
        <EmptyState title="Connect Search Console & GA4 first" description="Blog Impact reads the same Google connection as the rest of SEO (SEO → Site settings / Connections)." />
      ) : sites.data.length === 0 ? (
        <EmptyState title="No sites yet" description="Sites appear here once Search Console has been synced (SEO → Refresh data)." />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Site" className="min-w-72">
              <Select value={siteId ?? ""} onChange={(e) => setParam("site", e.target.value)}>
                {sites.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.domain} ({s.posts} {s.posts === 1 ? "post" : "posts"})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Period" className="w-40">
              <Select value={String(days)} onChange={(e) => setParam("days", e.target.value)}>
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    Last {p} days
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Traffic from">
              <div className="flex h-9 items-center rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Traffic from">
                {(
                  [
                    ["us", "US only"],
                    ["all", "All countries"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={country === v}
                    onClick={() => setParam("country", v)}
                    title={
                      v === "us"
                        ? "Searches made from the United States (Search Console) and visitors located in the US (GA4)"
                        : "Every country, as Google reports it"
                    }
                    className={cn(
                      "h-full rounded-md px-3 text-xs font-medium whitespace-nowrap",
                      country === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          {impact.error ? (
            <ErrorState title="Couldn't load this site" description={impact.error.message} />
          ) : !impact.data ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <SiteImpact data={impact.data} canManage={canManage} />
          )}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------ schedule ---- */

function ScheduleBar({ status, canManage }: { status: BlogStatus; canManage: boolean }) {
  const save = useSaveBlogSchedule();
  const refresh = useRefreshBlogs();
  const { toast } = useToast();
  const [draft, setDraft] = useState<BlogSchedule>(status.schedule);
  const [newTime, setNewTime] = useState("09:00");
  useEffect(() => setDraft(status.schedule), [status.schedule]);

  const dirty = draft.enabled !== status.schedule.enabled || draft.times.join() !== status.schedule.times.join();
  const run = status.lastRun;
  const addTime = () => {
    if (!newTime || draft.times.includes(newTime)) return;
    setDraft({ ...draft, times: [...draft.times, newTime].sort() });
  };
  const onSave = () =>
    save.mutate(
      { enabled: draft.enabled, times: draft.times },
      {
        onSuccess: () => toast({ variant: "success", title: "Refresh schedule saved" }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save the schedule", description: e.messages?.[0] ?? e.message }),
      },
    );
  const onRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: (r) =>
        toast({
          variant: r.status === "failed" ? "error" : "success",
          title: r.status === "running" ? "Refresh started" : r.status === "failed" ? "Refresh failed" : "Blog data refreshed",
          description: r.error ?? undefined,
        }),
      onError: (e) => toast({ variant: "error", title: "Couldn't refresh", description: e.messages?.[0] ?? e.message }),
    });

  return (
    <section aria-label="Refresh schedule" className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-semibold text-foreground">Data refresh schedule</span>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={draft.enabled}
            disabled={!canManage}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          Auto refresh on
        </label>
        <span className="text-sm text-muted-foreground">Times ({draft.timezone === "Asia/Karachi" ? "PKT" : draft.timezone}):</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {draft.times.length === 0 && <span className="text-sm text-muted-foreground">none</span>}
          {draft.times.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-md bg-primary-subtle py-0.5 pl-2.5 pr-1 text-sm font-medium tabular-nums text-primary-subtle-foreground">
              {t}
              {canManage && (
                <button
                  type="button"
                  aria-label={`Remove ${t}`}
                  className="rounded p-0.5 hover:bg-accent-hover"
                  onClick={() => setDraft({ ...draft, times: draft.times.filter((x) => x !== t) })}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </span>
          ))}
        </span>
        {canManage && (
          <span className="flex items-center gap-1.5">
            <Input type="time" aria-label="New refresh time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="h-8 w-28" />
            <Button size="sm" variant="outline" onClick={addTime} disabled={draft.times.length >= 8}>
              <Plus className="size-4" />
              Add time
            </Button>
          </span>
        )}
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">Runs within {status.schedule.checkEveryMinutes} min of each time</span>
        {canManage && (
          <>
            <Button size="sm" variant="outline" onClick={onSave} disabled={!dirty || save.isPending}>
              Save schedule
            </Button>
            <Button size="sm" variant="default" onClick={onRefresh} disabled={status.running || refresh.isPending || !status.connected}>
              <RefreshCw className={cn("size-4", (status.running || refresh.isPending) && "animate-spin")} />
              {status.running || refresh.isPending ? "Refreshing…" : "Refresh now"}
            </Button>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>
          Last run:{" "}
          {run ? (
            <>
              {fmtAgo(run.finishedAt ?? run.startedAt)} ({run.trigger === "manual" ? "Refresh now" : "scheduled"}) ·{" "}
              <RunStatus run={run} total={status.sitesTotal} />
            </>
          ) : (
            "never"
          )}
        </span>
        <span>Next: {status.schedule.enabled && status.schedule.nextAt ? fmtDateTime(status.schedule.nextAt) : "auto refresh is off"}</span>
        {run?.error && <span className="text-warning-text">{run.error}</span>}
      </div>
    </section>
  );
}

function RunStatus({ run, total }: { run: NonNullable<BlogStatus["lastRun"]>; total: number | null }) {
  if (run.status === "running") {
    const pct = total ? Math.min(100, Math.round((run.sites / total) * 100)) : null;
    return (
      <span className="inline-flex items-center gap-2 font-medium text-foreground">
        running… {total ? `${run.sites} of ${total} sites done` : `${run.sites} sites done`}
        {pct != null && (
          <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
    );
  }
  const parts = [`${run.sites} site${run.sites === 1 ? "" : "s"} checked`];
  if (run.sitesUnchanged) parts.push(`${run.sitesUnchanged} had nothing new in Search Console`);
  if (run.sitesFailed) parts.push(`${run.sitesFailed} failed`);
  return <span className={run.status === "failed" ? "text-text-destructive" : undefined}>{parts.join(", ")}</span>;
}

/* ---------------------------------------------------------------- site ---- */

function pctText(v: number | null | undefined): string {
  if (v == null) return "nothing to compare yet";
  return `${v > 0 ? "▲" : v < 0 ? "▼" : ""} ${Math.round(Math.abs(v))}% vs prev. period`;
}
const toneOf = (v: number | null | undefined) => (v == null || v === 0 ? "neutral" : v > 0 ? "ok" : "warning");

function SiteImpact({ data, canManage }: { data: BlogImpact; canManage: boolean }) {
  const f = data.freshness;
  const k = data.kpis;
  const us = data.country === "us";
  return (
    <>
      <FreshnessStrip data={data} />
      {us && !data.countryReady && (
        <InfoNote>
          US-only numbers for this site haven&apos;t been fetched yet — they come in with the next refresh ({canManage ? "Refresh now above, or " : ""}the next scheduled
          run). Until then switch to <b>All countries</b> to see the totals.
        </InfoNote>
      )}
      {f.error && <InfoNote className="border-destructive/40 text-text-destructive">Last refresh for this site failed: {f.error}</InfoNote>}
      {f.warning && <InfoNote>{f.warning}</InfoNote>}

      {data.posts.length === 0 ? (
        <EmptyState
          title="No blog posts found on this site yet"
          description="Each day the refresh looks for posts in the site's public WordPress feed, then its post sitemap, then blog-looking pages SEO already knows. Nothing from the blog-writing workflow is used."
        />
      ) : (
        <>
          <section aria-label="Blog summary" className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
            <StatTile label="Blog posts live" value={k.postsLive} status={`${k.postsThisMonth} published this month`} />
            <StatTile
              label="Indexed by Google"
              value={`${k.postsIndexed} / ${k.postsLive}`}
              status={k.avgDaysToIndex != null ? `avg ${k.avgDaysToIndex} days to index` : "days to index unknown"}
              tone={k.postsIndexed < k.postsLive ? "warning" : "neutral"}
            />
            <StatTile label={`Blog clicks (${data.window.days}d)`} value={fmtNum(k.clicks)} status={pctText(k.clicksChangePct)} tone={toneOf(k.clicksChangePct)} />
            <StatTile label={`Blog impressions (${data.window.days}d)`} value={fmtShort(k.impressions)} status={pctText(k.impressionsChangePct)} tone={toneOf(k.impressionsChangePct)} />
            <StatTile
              label="Share of organic clicks"
              value={k.shareOfOrganicClicks != null ? `${k.shareOfOrganicClicks}%` : "—"}
              status={k.shareOfOrganicClicksPrev != null ? `was ${k.shareOfOrganicClicksPrev}% before` : us ? "needs a blog refresh" : "needs the daily SEO sync"}
              hint={us ? "Blog clicks ÷ all the site's organic clicks, both from US searches" : "Blog clicks ÷ all the site's organic clicks"}
            />
            <StatTile
              label="Order clicks (blogs)"
              value={data.site.hasGa4 ? fmtNum(k.orderClicks) : "—"}
              status={data.site.hasGa4 ? `${k.orderClicksPrev} in prev. period` : "link a GA4 property"}
              hint="GA4 outbound clicks from a blog page to online-ordering.innowi.com (enhanced measurement must be on)"
            />
          </section>

          <div className="flex flex-wrap gap-4">
            <WeeklyChart data={data} />
            <BeforeAfter data={data} canManage={canManage} />
          </div>

          {data.early.length > 0 && <EarlySignals data={data} />}
          <PostsTable data={data} />
        </>
      )}
    </>
  );
}

function FreshnessStrip({ data }: { data: BlogImpact }) {
  const f = data.freshness;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
      <Badge tone={data.country === "us" ? "accent" : "neutral"} icon={false}>
        {data.country === "us" ? "US traffic only" : "All countries"}
      </Badge>
      <span className="inline-flex items-center gap-1.5">
        <Dot ok={!!f.finalThrough} />
        <b className="font-semibold">Search Console</b>
        <span className="text-muted-foreground">
          final through {fmtDay(f.finalThrough)}
          {f.freshThroughHour && <> · fresh (provisional) to {fmtDateTime(f.freshThroughHour)}</>}
        </span>
      </span>
      <span className="text-muted-foreground" title="When we last asked Google, and when Google last had new data for this site">
        Last checked {fmtAgo(f.checkedAt)} · Google had new data {fmtAgo(f.changedAt)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot ok={!!f.ga4Through} />
        <b className="font-semibold">GA4</b>
        <span className="text-muted-foreground">{data.site.hasGa4 ? `through ${fmtDay(f.ga4Through)}` : "no property linked"}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot ok={!!f.discoveredOn} />
        <b className="font-semibold">Posts</b>
        <span className="text-muted-foreground">
          {data.posts.length} found · checked {fmtDay(f.discoveredOn)}
        </span>
      </span>
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return <span aria-hidden className={cn("size-2 rounded-full", ok ? "bg-success" : "bg-muted-foreground/40")} />;
}

/* --------------------------------------------------------------- chart ---- */

function WeeklyChart({ data }: { data: BlogImpact }) {
  const max = Math.max(1, ...data.weeks.map((w) => w.blogClicks + w.otherClicks));
  return (
    <Section title="Organic clicks per week — blogs vs. rest of site" className="min-w-0 flex-[999_1_32rem] rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <Legend swatch="bg-[var(--series-1)]" label="Blog pages" />
        <Legend swatch="bg-[var(--chart-5)]" label="Other pages" />
        <Legend swatch="bg-[var(--series-2)] w-0.5 h-3" label="Posts published that week" />
      </div>
      <div className="flex h-56 items-end gap-2 border-b border-border pt-4" role="img" aria-label="Weekly organic clicks, blog pages versus other pages">
        {data.weeks.map((w) => (
          <div key={w.start} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${fmtRange(w.start, w.end)}: ${w.blogClicks} blog clicks, ${w.otherClicks} other clicks, ${w.published} published`}>
            <span className="h-4 text-[10px] font-semibold text-[var(--series-2)]">{w.published ? `+${w.published}` : ""}</span>
            <div className={cn("flex w-full max-w-10 flex-col justify-end", w.published && "border-t-2 border-[var(--series-2)]")}>
              <div className="rounded-t-[3px] bg-[var(--series-1)]" style={{ height: `${(w.blogClicks / max) * 180}px` }} />
              <div className="bg-[var(--chart-5)]" style={{ height: `${(w.otherClicks / max) * 180}px` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {data.weeks.map((w) => (
          <span key={w.start} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground">
            {fmtDay(w.start, false)}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Final Search Console days only (through {fmtDay(data.window.end)}). Days still provisional are left out of impact numbers.</p>
    </Section>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-2.5 rounded-sm", swatch)} />
      {label}
    </span>
  );
}

/* -------------------------------------------------------- before/after ---- */

function BeforeAfter({ data, canManage }: { data: BlogImpact; canManage: boolean }) {
  const ba = data.beforeAfter;
  const [editing, setEditing] = useState(false);
  return (
    <Section title="Before vs. after blogging" className="flex-[1_1_20rem] rounded-lg border border-border bg-card p-4">
      {!ba ? (
        <p className="text-sm text-muted-foreground">No publish dates known for this site&apos;s posts yet.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            First post {fmtDay(ba.firstPostOn)}.{" "}
            {ba.available && ba.before && ba.after
              ? `${ba.days} days before (${fmtRange(ba.before.start, ba.before.end)}) vs the latest ${ba.days} (${fmtRange(ba.after.start, ba.after.end)}), final data, searches without the restaurant's name.`
              : ba.reason}
          </p>
          {ba.metrics?.map((m) => (
            <div key={m.key} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0">
              <span className="text-sm font-medium text-foreground">{m.label}</span>
              <span className="flex items-baseline justify-between text-sm text-muted-foreground">
                <span className="tabular-nums">
                  {fmtNum(m.before)} → <b className="font-semibold text-foreground">{fmtNum(m.after)}</b>
                </span>
                <span className={cn("font-semibold tabular-nums", m.changePct == null ? "" : m.changePct >= 0 ? "text-success-subtle-foreground" : "text-text-destructive")}>
                  {m.changePct == null ? "—" : `${m.changePct > 0 ? "▲" : "▼"} ${Math.abs(m.changePct)}%`}
                </span>
              </span>
            </div>
          ))}
        </>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        Brand terms left out: {data.freshness.brandTerms.length ? data.freshness.brandTerms.map((t) => <Badge key={t} tone="outline" icon={false}>{t}</Badge>) : "none"}
        {canManage && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label="Edit brand terms">
            <Pencil className="size-3.5" />
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">Shows change over the same period, not proof the blogs caused it (season, ads and Google Business Profile also move traffic).</p>
      {editing && <BrandTermsDialog siteId={data.site.id} terms={data.freshness.brandTerms} onClose={() => setEditing(false)} />}
    </Section>
  );
}

function BrandTermsDialog({ siteId, terms, onClose }: { siteId: string; terms: string[]; onClose: () => void }) {
  const save = useSaveBrandTerms();
  const { toast } = useToast();
  const [text, setText] = useState(terms.join(", "));
  const submit = () =>
    save.mutate(
      { siteId, terms: text.split(",").map((t) => t.trim()).filter(Boolean) },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Brand terms saved", description: "Non-brand history is fetched again on the next refresh." });
          onClose();
        },
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: e.messages?.[0] ?? e.message }),
      },
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Brand terms"
      description="Searches containing any of these count as brand searches and are left out of the before/after numbers. Up to 5, comma separated."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={submit} disabled={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Terms">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="pho ha plus, phohaplus" />
      </Field>
    </Dialog>
  );
}

/* ------------------------------------------------------- early signals ---- */

function EarlySignals({ data }: { data: BlogImpact }) {
  return (
    <Section title="New posts — early signals (last 10 days, hourly data)" aside={<Badge tone="warning" icon={false}>Provisional</Badge>}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-3">
        {data.early.map((e) => {
          const max = Math.max(1, ...e.series.map((s) => s.impressions));
          return (
            <div key={e.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
              <a href={e.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-foreground hover:underline">
                {e.title ?? e.url}
              </a>
              <span className="text-xs text-muted-foreground">
                Published {fmtDay(e.publishedOn)} · Last Google crawl {e.lastCrawlAt ? fmtDateTime(e.lastCrawlAt) : "not yet"}
              </span>
              <div className="flex h-10 items-end gap-0.5" role="img" aria-label={`Daily impressions over the last ${e.series.length} days`}>
                {e.series.map((s) => (
                  <div key={s.date} title={`${fmtDay(s.date)}: ${s.impressions}`} className="flex-1 rounded-t-sm bg-[var(--chart-4)]" style={{ height: `${Math.max(2, (s.impressions / max) * 40)}px` }} />
                ))}
              </div>
              <span className="flex justify-between text-xs">
                <span>
                  {fmtNum(e.impressions)} impressions · {fmtNum(e.clicks)} clicks
                </span>
                <span className={cn("font-semibold", e.indexed ? "text-success-subtle-foreground" : "text-warning-text")}>
                  {e.indexed ? (e.daysToIndex != null ? `Indexed in ${e.daysToIndex} day${e.daysToIndex === 1 ? "" : "s"}` : "Indexed") : "Not indexed yet"}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------- table ---- */

function PostsTable({ data }: { data: BlogImpact }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? data.posts.filter((p) => `${p.title ?? ""} ${p.path} ${p.topQuery ?? ""}`.toLowerCase().includes(needle)) : data.posts;
  }, [q, data.posts]);
  const pg = usePager(rows);
  const csv = () =>
    downloadCsv(
      `blog-impact-${data.site.domain}-${data.country === "us" ? "us-" : ""}${data.window.end}.csv`,
      [
        ["Title", "URL", "Published", "Indexed", "Last Google crawl", "Impressions", "Clicks", "CTR %", "Avg position", "Top query", "Organic visits", "Order clicks"],
        ...rows.map((p) => [
          p.title ?? "", p.url, p.publishedOn ?? "", p.indexed ? "yes" : "no", p.lastCrawlAt ?? "", p.impressions, p.clicks, p.ctr ?? "", p.position ?? "",
          p.topQuery ?? "", p.organicSessions, p.orderClicks,
        ]),
      ],
    );
  return (
    <Section
      title={`Every blog post (${data.posts.length}) — ${fmtRange(data.window.start, data.window.end)}`}
      aside={
        <span className="flex items-center gap-2">
          <Input
            aria-label="Search blogs"
            placeholder="Search blogs…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              pg.reset();
            }}
            className="h-8 w-56"
          />
          <Button size="sm" variant="outline" onClick={csv}>
            <Download className="size-4" />
            CSV
          </Button>
        </span>
      }
    >
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-52">Blog</TableHead>
              <TableHead>Published</TableHead>
              <TableHead>Indexed</TableHead>
              <TableHead>
                <HeadHint label="Last crawl" hint="When Googlebot last fetched the post (URL Inspection)" />
              </TableHead>
              <TableHead className="text-right">Impr.</TableHead>
              <TableHead className="text-right">Clicks</TableHead>
              <TableHead className="text-right">CTR</TableHead>
              <TableHead className="text-right">Avg pos.</TableHead>
              <TableHead>Top query</TableHead>
              <TableHead className="whitespace-nowrap text-right">
                <HeadHint label="Visits" hint={`Organic visits: GA4 sessions from Google search that started on the post, ${fmtRange(data.window.ga4Start, data.window.ga4End)}`} />
              </TableHead>
              <TableHead className="whitespace-nowrap text-right">
                <HeadHint label="Orders" hint="Order clicks: GA4 clicks from the post to online-ordering.innowi.com" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableMessageRow colSpan={11}>
                <p className="py-6 text-center text-sm text-muted-foreground">No posts match.</p>
              </TableMessageRow>
            ) : (
              pg.rows.map((p) => <PostRow key={p.id} p={p} />)
            )}
          </TableBody>
        </Table>
      </div>
      {pg.bar}
      <p className="text-xs text-muted-foreground">
        Posts are found on the live site (its WordPress feed, post sitemap or crawled pages) · clicks, impressions and position from Search Console (final days) · visits and order clicks from GA4.
      </p>
    </Section>
  );
}

function PostRow({ p }: { p: BlogPostRow }) {
  return (
    <TableRow>
      <TableCell className="max-w-72">
        <a href={p.url} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:underline">
          {p.title ?? p.path}
        </a>
        <div className="truncate text-[11px] text-muted-foreground">{p.path}</div>
      </TableCell>
      <TableCell className="whitespace-nowrap">{fmtDay(p.publishedOn, false)}</TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge tone={p.indexed ? "success" : "warning"} icon={false} title={p.coverageState ?? undefined}>
          {p.indexed ? "Indexed" : p.inspectedAt ? "Not yet" : "Not checked"}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground" title={p.lastCrawlAt ? fmtDateTime(p.lastCrawlAt) : undefined}>
        {p.lastCrawlAt ? fmtDay(p.lastCrawlAt.slice(0, 10), false) : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">{fmtNum(p.impressions)}</TableCell>
      <TableCell className="text-right font-semibold tabular-nums">
        {fmtNum(p.clicks)}
        {p.freshClicks > 0 && <span className="ml-1 text-[11px] font-normal text-warning-text" title="Clicks on days Google hasn't finalised yet (not in the total)">+{p.freshClicks}</span>}
      </TableCell>
      <TableCell className="text-right tabular-nums">{p.ctr != null ? `${p.ctr}%` : "—"}</TableCell>
      <TableCell className="text-right tabular-nums">{p.position ?? "—"}</TableCell>
      <TableCell className="max-w-44 truncate text-muted-foreground" title={p.topQuery ?? undefined}>
        {p.topQuery ?? "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">{fmtNum(p.organicSessions)}</TableCell>
      <TableCell className="text-right font-semibold tabular-nums">{fmtNum(p.orderClicks)}</TableCell>
    </TableRow>
  );
}
