"use client";

import { useEffect, useRef } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { seo } from "@/lib/api/resources/seo";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type {
  BlogImpact,
  BlogRun,
  BlogSchedule,
  BlogStatus,
  CrawlerKey,
  CrawlerStatus,
  CrawlJob,
  CrawlPageQuery,
  FindingQuery,
  QueueResult,
  Report,
  ReportNoteKey,
  SeoStatus,
  SiteInput,
  SyncRun,
} from "./types";

/** Connection + sync status. Polls every 4 s while a sync runs, then refreshes every SEO page. */
export function useSeoStatus() {
  const qc = useQueryClient();
  const q = useQuery<SeoStatus, ApiError>({
    queryKey: queryKeys.seo.status(),
    queryFn: () => seo.status(),
    refetchInterval: (query) => (query.state.data?.running ? 4000 : false),
  });
  const wasRunning = useRef(false);
  const running = !!q.data?.running;
  useEffect(() => {
    if (wasRunning.current && !running) void qc.invalidateQueries({ queryKey: queryKeys.seo.all });
    wasRunning.current = running;
  }, [running, qc]);
  return q;
}

export const useSeoOverview = () => useQuery({ queryKey: queryKeys.seo.overview(), queryFn: () => seo.overview() });
export const useWatchdog = () => useQuery({ queryKey: queryKeys.seo.watchdog(), queryFn: () => seo.watchdog(40) });
export const useSeoSites = () => useQuery({ queryKey: queryKeys.seo.sites(), queryFn: () => seo.sites() });
export const useSeoSite = (id: string) => useQuery({ queryKey: queryKeys.seo.site(id), queryFn: () => seo.site(id) });
export const useSitePages = (id: string) => useQuery({ queryKey: queryKeys.seo.pages(id), queryFn: () => seo.pages(id) });
export const useSiteCrawl = (id: string) => useQuery({ queryKey: queryKeys.seo.crawl(id), queryFn: () => seo.crawl(id) });
export const useCrawlPages = (id: string, q: CrawlPageQuery) =>
  useQuery({ queryKey: queryKeys.seo.crawlPages(id, q), queryFn: () => seo.crawlPages(id, q), placeholderData: keepPreviousData });
export const useFindings = (q: FindingQuery) =>
  useQuery({ queryKey: queryKeys.seo.findings(q), queryFn: () => seo.findings(q), placeholderData: keepPreviousData });
export const useReportsCenter = (days: number) =>
  useQuery({ queryKey: queryKeys.seo.reports(days), queryFn: () => seo.reportsCenter(days), placeholderData: keepPreviousData });
export const useReport = (id: string) => useQuery({ queryKey: queryKeys.seo.report(id), queryFn: () => seo.report(id) });
export const useKpis = () => useQuery({ queryKey: queryKeys.seo.kpis(), queryFn: () => seo.kpis() });
export const useCompare = (ids: string[]) =>
  useQuery({ queryKey: queryKeys.seo.compare(ids.join(",")), queryFn: () => seo.compare(ids), enabled: ids.length >= 2, placeholderData: keepPreviousData });
export const useLinkOptions = (q: string, enabled = true) =>
  useQuery({ queryKey: queryKeys.seo.linkOptions(q), queryFn: () => seo.linkOptions(q), enabled, placeholderData: keepPreviousData });
export const useMerchantSeo = (merchantId: string) =>
  useQuery({ queryKey: queryKeys.seo.merchant(merchantId), queryFn: () => seo.merchantSites(merchantId) });
export const useSyncRuns = (enabled: boolean) =>
  useQuery<SyncRun[], ApiError>({ queryKey: queryKeys.seo.runs(), queryFn: () => seo.runs(8), enabled });

/** Every SEO mutation refreshes all SEO data: scores, findings and reports depend on each other. */
function useSeoMutation<TVars, TData = unknown>(fn: (v: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation<TData, ApiError, TVars>({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.seo.all }) });
}

export function useConnectSeo(returnTo: "seo" | "settings") {
  return useMutation<{ url: string }, ApiError, void>({
    mutationFn: () => seo.connect(returnTo),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}
export const useDisconnectSeo = () => useSeoMutation<void>(() => seo.disconnect());
export const useStartSync = () => useSeoMutation<void, SyncRun>(() => seo.sync());
export function useSampleData() {
  return {
    load: useSeoMutation<void, { sites: number }>(() => seo.loadSampleData()),
    remove: useSeoMutation<void, { removed: number }>(() => seo.removeSampleData()),
  };
}
export const useUpdateSite = () => useSeoMutation<{ id: string; body: SiteInput }>(({ id, body }) => seo.updateSite(id, body));
export const useAddSite = () => useSeoMutation<{ domain: string; name?: string }, { id: string }>(({ domain, name }) => seo.addSite(domain, name));
export const useDeleteSite = () => useSeoMutation<string, void>((id) => seo.deleteSite(id));
export const useRescore = () => useSeoMutation<string>((id) => seo.rescore(id));
export const useRunPagespeed = () => useSeoMutation<string, Awaited<ReturnType<typeof seo.pagespeed>>>((id) => seo.pagespeed(id));
export const useAddKeyword = () => useSeoMutation<{ siteId: string; keyword: string }>(({ siteId, keyword }) => seo.addKeyword(siteId, keyword));
export const useDeleteKeyword = () => useSeoMutation<string, void>((id) => seo.deleteKeyword(id));
export const useUpdateFinding = () =>
  useSeoMutation<{ id: string; state?: string; outcome?: "fixed" | "dismissed"; ownerId?: string | null; note?: string }>(({ id, ...body }) =>
    seo.updateFinding(id, body),
  );
export const useGenerateReport = () =>
  useSeoMutation<{ siteId: string; period?: { periodStart: string; periodEnd: string } }, Awaited<ReturnType<typeof seo.generateReport>>>(({ siteId, period }) =>
    seo.generateReport(siteId, period),
  );
export const useUpdateSummary = () => useSeoMutation<{ id: string; paragraphs: string[]; section?: ReportNoteKey }, Report>(({ id, paragraphs, section }) => seo.updateSummary(id, paragraphs, section));
export const useUpdateNextSteps = () => useSeoMutation<{ id: string; nextSteps: string[] }, Report>(({ id, nextSteps }) => seo.updateNextSteps(id, nextSteps));
export const useSignOff = () => useSeoMutation<string>((id) => seo.signOff(id));
export const useTestEmail = () => useMutation<{ sentTo: string; from: string }, ApiError, string | undefined>({ mutationFn: (to) => seo.testEmail(to) });
export const useSendReport = () => useSeoMutation<{ id: string; recipients: string[] }>(({ id, recipients }) => seo.send(id, recipients));
export const useUpdateKpi = () => useSeoMutation<{ key: string; target?: string; status?: string }>(({ key, ...body }) => seo.updateKpi(key, body));
export const useAddKpi = () => useSeoMutation<{ set: number; name: string; grader: string; target: string; source: string }>((b) => seo.addKpi(b));
export const useDeleteKpi = () => useSeoMutation<string, void>((key) => seo.deleteKpi(key));

/* ------------------------------------------------------------ Blog Impact ---- */
/** Blog refresh status. Polls every 4 s while a refresh runs, then refreshes the Blog Impact data. */
export function useBlogStatus() {
  const qc = useQueryClient();
  const q = useQuery<BlogStatus, ApiError>({
    queryKey: queryKeys.seo.blogStatus(),
    queryFn: () => seo.blogStatus(),
    refetchInterval: (query) => (query.state.data?.running ? 4000 : 60_000),
  });
  const wasRunning = useRef(false);
  const running = !!q.data?.running;
  useEffect(() => {
    if (wasRunning.current && !running) void qc.invalidateQueries({ queryKey: [...queryKeys.seo.all, "blogs"] });
    wasRunning.current = running;
  }, [running, qc]);
  return q;
}
export const useBlogSites = () => useQuery({ queryKey: queryKeys.seo.blogSites(), queryFn: () => seo.blogSites() });
export const useBlogImpact = (siteId: string | null, days: number, country: "all" | "us" = "all") =>
  useQuery<BlogImpact, ApiError>({
    queryKey: queryKeys.seo.blogImpact(siteId ?? "", days, country),
    queryFn: () => seo.blogImpact(siteId as string, days, country),
    enabled: !!siteId,
    placeholderData: keepPreviousData,
  });
function useBlogMutation<TVars, TData = unknown>(fn: (v: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation<TData, ApiError, TVars>({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: [...queryKeys.seo.all, "blogs"] }) });
}
export const useSaveBlogSchedule = () => useBlogMutation<{ enabled: boolean; times: string[] }, BlogSchedule>((b) => seo.saveBlogSchedule(b));
export const useRefreshBlogs = () => useBlogMutation<void, BlogRun>(() => seo.refreshBlogs());
export const useSaveBrandTerms = () => useBlogMutation<{ siteId: string; terms: string[] }, { brandTerms: string[] }>(({ siteId, terms }) => seo.saveBrandTerms(siteId, terms));

/* ---------------------------------------------------- Screaming Frog crawler ---- */

/** Crawler helpers + queue. Polls every 10 s while crawls wait or run (a minute otherwise); when one finishes,
 *  every SEO page is refreshed so the new crawl, scores and findings show. */
export function useCrawlerStatus() {
  const qc = useQueryClient();
  const q = useQuery<CrawlerStatus, ApiError>({
    queryKey: queryKeys.seo.crawler(),
    queryFn: () => seo.crawlerStatus(),
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && d.queued + d.running + d.saving > 0 ? 10_000 : 60_000;
    },
  });
  const done = useRef<number | null>(null);
  const finished = q.data ? Object.values(q.data.sites).filter((j) => j.status === "done").length : null;
  useEffect(() => {
    if (finished == null) return;
    if (done.current != null && finished > done.current) {
      void qc.invalidateQueries({ predicate: (query) => query.queryKey[0] === "seo" && query.queryKey[1] !== "crawler" });
    }
    done.current = finished;
  }, [finished, qc]);
  return q;
}

function useCrawlerMutation<TVars, TData = unknown>(fn: (v: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation<TData, ApiError, TVars>({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.seo.crawler() }) });
}
export const useQueueCrawl = () => useCrawlerMutation<{ siteIds?: string[]; all?: boolean }, QueueResult>((b) => seo.queueCrawl(b));
export const useCancelCrawl = () => useCrawlerMutation<string, CrawlJob>((id) => seo.cancelCrawl(id));
export const useCrawlerKeys = () => useQuery<CrawlerKey[], ApiError>({ queryKey: queryKeys.seo.crawlerKeys(), queryFn: () => seo.crawlerKeys() });
export const useCreateCrawlerKey = () => useCrawlerMutation<string, CrawlerKey & { key: string }>((name) => seo.createCrawlerKey(name));
export const useRevokeCrawlerKey = () => useCrawlerMutation<string, CrawlerKey>((id) => seo.revokeCrawlerKey(id));
