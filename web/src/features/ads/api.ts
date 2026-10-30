"use client";

import { useEffect, useRef } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ads } from "@/lib/api/resources/ads";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type {
  AccountDetail,
  AccountListItem,
  AdsComment,
  AdsStatus,
  Asset,
  Breakdown,
  ImportResult,
  MerchantSuggestion,
  MonthlyReport,
  Offers,
  PeriodQuery,
  Portfolio,
  SyncRun,
  Trend,
  Unmapped,
} from "./types";

/** Connection + sync status. Polls every 4 s while a sync runs, then refreshes every Ads report. */
export function useAdsStatus() {
  const qc = useQueryClient();
  const q = useQuery<AdsStatus, ApiError>({
    queryKey: queryKeys.ads.status(),
    queryFn: () => ads.status(),
    refetchInterval: (query) => (query.state.data?.running ? 4000 : false),
  });
  const wasRunning = useRef(false);
  const running = !!q.data?.running;
  useEffect(() => {
    if (wasRunning.current && !running) void qc.invalidateQueries({ queryKey: queryKeys.ads.all });
    wasRunning.current = running;
  }, [running, qc]);
  return q;
}

export function usePortfolio(q: PeriodQuery) {
  return useQuery<Portfolio, ApiError>({ queryKey: queryKeys.ads.portfolio(q), queryFn: () => ads.portfolio(q), placeholderData: keepPreviousData });
}

export function useAccount(id: string, q: PeriodQuery) {
  return useQuery<AccountDetail, ApiError>({ queryKey: queryKeys.ads.account(id, q), queryFn: () => ads.account(id, q), placeholderData: keepPreviousData });
}

export function useAccountTrend(id: string, q: PeriodQuery & { campaign?: string }) {
  return useQuery<Trend, ApiError>({ queryKey: queryKeys.ads.trend(id, q), queryFn: () => ads.trend(id, q), placeholderData: keepPreviousData });
}

export function useAssets(id: string) {
  return useQuery<Asset[], ApiError>({ queryKey: queryKeys.ads.assets(id), queryFn: () => ads.assets(id) });
}

export function useOffers(id: string) {
  return useQuery<Offers, ApiError>({ queryKey: queryKeys.ads.offers(id), queryFn: () => ads.offers(id) });
}

export function useBreakdown(id: string, month: string | undefined) {
  return useQuery<Breakdown, ApiError>({
    queryKey: queryKeys.ads.breakdown(id, month),
    queryFn: () => ads.breakdown(id, month),
    placeholderData: keepPreviousData,
  });
}

export function useMonthlyReport(month: string | undefined) {
  return useQuery<MonthlyReport, ApiError>({
    queryKey: queryKeys.ads.monthly(month),
    queryFn: () => ads.monthlyReport(month),
    placeholderData: keepPreviousData,
  });
}

export function useUnmapped() {
  return useQuery<Unmapped, ApiError>({ queryKey: queryKeys.ads.unmapped(), queryFn: () => ads.unmapped() });
}

export function useAccountList(state?: "active" | "archived" | "ignored") {
  return useQuery<AccountListItem[], ApiError>({ queryKey: queryKeys.ads.accounts(state), queryFn: () => ads.accounts(state) });
}

export function useSyncRuns(enabled: boolean) {
  return useQuery<SyncRun[], ApiError>({ queryKey: queryKeys.ads.runs(), queryFn: () => ads.runs(8), enabled });
}

export function useMerchantAds(merchantId: string) {
  return useQuery({ queryKey: queryKeys.ads.merchant(merchantId), queryFn: () => ads.merchantAccounts(merchantId) });
}

/* ------------------------------------------------------------ actions ---- */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.ads.all });
}

/** Starts Google sign-in; Google sends the browser back to the page it started from. */
export function useConnectAds(returnTo: "ads" | "settings") {
  return useMutation<{ url: string }, ApiError, void>({
    mutationFn: () => ads.connect(returnTo),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });
}

export function useDisconnectAds() {
  const done = useInvalidateAll();
  return useMutation<void, ApiError, void>({ mutationFn: () => ads.disconnect(), onSettled: done });
}

export function useStartSync() {
  const qc = useQueryClient();
  return useMutation<SyncRun, ApiError, "quick" | "full">({
    mutationFn: (mode) => ads.sync(mode),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.ads.status() });
      void qc.invalidateQueries({ queryKey: queryKeys.ads.runs() });
    },
  });
}

export function useSampleData() {
  const done = useInvalidateAll();
  return {
    load: useMutation<{ accounts: number }, ApiError, void>({ mutationFn: () => ads.loadSampleData(), onSettled: done }),
    remove: useMutation<{ removed: number }, ApiError, void>({ mutationFn: () => ads.removeSampleData(), onSettled: done }),
  };
}

export function useUpdateAccount(id: string) {
  const done = useInvalidateAll();
  return useMutation<unknown, ApiError, Parameters<typeof ads.updateAccount>[1]>({ mutationFn: (patch) => ads.updateAccount(id, patch), onSuccess: done });
}

/** For lists where the account id varies per row (Unmapped → Ignore). */
export function useUpdateAnyAccount() {
  const done = useInvalidateAll();
  return useMutation<unknown, ApiError, { id: string; patch: Parameters<typeof ads.updateAccount>[1] }>({
    mutationFn: ({ id, patch }) => ads.updateAccount(id, patch),
    onSuccess: done,
  });
}

export function useAddAccount() {
  const done = useInvalidateAll();
  return useMutation<unknown, ApiError, { customerId: string; name: string }>({ mutationFn: (v) => ads.addAccount(v.customerId, v.name), onSuccess: done });
}

export function useImportAccounts() {
  const done = useInvalidateAll();
  return useMutation<ImportResult, ApiError, File>({ mutationFn: (file) => ads.importAccounts(file), onSuccess: done });
}

export function useMerchantSuggestions(id: string, enabled: boolean) {
  return useQuery<MerchantSuggestion[], ApiError>({ queryKey: queryKeys.ads.suggestions(id), queryFn: () => ads.suggestions(id), enabled });
}

export function useLinkMerchant() {
  const done = useInvalidateAll();
  return {
    link: useMutation<unknown, ApiError, { id: string; merchantId: string }>({ mutationFn: (v) => ads.link(v.id, v.merchantId), onSuccess: done }),
    unlink: useMutation<unknown, ApiError, string>({ mutationFn: (id) => ads.unlink(id), onSuccess: done }),
  };
}

export function useComments(id: string) {
  return useQuery<AdsComment[], ApiError>({ queryKey: queryKeys.ads.comments(id), queryFn: () => ads.comments(id) });
}

export function useCommentMutations(id: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: queryKeys.ads.comments(id) });
  return {
    add: useMutation<AdsComment, ApiError, string>({ mutationFn: (body) => ads.addComment(id, body), onSuccess: done }),
    edit: useMutation<AdsComment, ApiError, { commentId: string; body: string }>({ mutationFn: (v) => ads.editComment(v.commentId, v.body), onSuccess: done }),
    remove: useMutation<void, ApiError, string>({ mutationFn: (commentId) => ads.deleteComment(commentId), onSuccess: done }),
  };
}
