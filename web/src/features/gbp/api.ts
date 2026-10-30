"use client";

import { useEffect, useRef } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gbp } from "@/lib/api/resources/gbp";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { GbpNote, GbpStatus, LocationReport, MerchantSuggestion, Overview, RangeQuery, SyncRun } from "./types";

/** Connection + sync status. Polls every 4 s while a sync is running, then
 *  refreshes every GBP report once it finishes. */
export function useGbpStatus() {
  const qc = useQueryClient();
  const q = useQuery<GbpStatus, ApiError>({
    queryKey: queryKeys.gbp.status(),
    queryFn: () => gbp.status(),
    refetchInterval: (query) => (query.state.data?.running ? 4000 : false),
  });
  const wasRunning = useRef(false);
  const running = !!q.data?.running;
  useEffect(() => {
    if (wasRunning.current && !running) {
      void qc.invalidateQueries({ queryKey: queryKeys.gbp.all });
    }
    wasRunning.current = running;
  }, [running, qc]);
  return q;
}

export function useGbpOverview(range: RangeQuery) {
  return useQuery<Overview, ApiError>({
    queryKey: queryKeys.gbp.overview(range),
    queryFn: () => gbp.overview(range),
    placeholderData: keepPreviousData,
  });
}

export function useGbpReport(id: string, range: RangeQuery & { keywordMonth?: string }) {
  return useQuery<LocationReport, ApiError>({
    queryKey: queryKeys.gbp.report(id, range),
    queryFn: () => gbp.report(id, range),
    placeholderData: keepPreviousData,
  });
}

export function useSyncRuns(enabled: boolean) {
  return useQuery<SyncRun[], ApiError>({ queryKey: queryKeys.gbp.runs(), queryFn: () => gbp.runs(8), enabled });
}

/** Starts Google sign-in; Google sends the browser back to the page it
 *  started from (`returnTo`). */
export function useConnectGbp(returnTo: "gbp" | "settings") {
  return useMutation<{ url: string }, ApiError, void>({
    mutationFn: () => gbp.connect(returnTo),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });
}

export function useDisconnectGbp() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => gbp.disconnect(),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.gbp.all }),
  });
}

export function useStartSync() {
  const qc = useQueryClient();
  return useMutation<SyncRun, ApiError, void>({
    mutationFn: () => gbp.sync(),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.gbp.status() });
      void qc.invalidateQueries({ queryKey: queryKeys.gbp.runs() });
    },
  });
}

export function useGbpNotes(id: string) {
  return useQuery<GbpNote[], ApiError>({ queryKey: queryKeys.gbp.notes(id), queryFn: () => gbp.notes(id) });
}

export function useNoteMutations(id: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: queryKeys.gbp.notes(id) });
  return {
    add: useMutation<GbpNote, ApiError, string>({ mutationFn: (body) => gbp.addNote(id, body), onSuccess: done }),
    edit: useMutation<GbpNote, ApiError, { noteId: string; body: string }>({
      mutationFn: ({ noteId, body }) => gbp.editNote(noteId, body),
      onSuccess: done,
    }),
    remove: useMutation<void, ApiError, string>({ mutationFn: (noteId) => gbp.deleteNote(noteId), onSuccess: done }),
  };
}

export function useMerchantSuggestions(id: string, enabled: boolean) {
  return useQuery<MerchantSuggestion[], ApiError>({
    queryKey: queryKeys.gbp.suggestions(id),
    queryFn: () => gbp.suggestions(id),
    enabled,
  });
}

export function useLinkMerchant(id: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: queryKeys.gbp.all });
  return {
    link: useMutation<unknown, ApiError, string>({ mutationFn: (merchantId) => gbp.link(id, merchantId), onSuccess: done }),
    unlink: useMutation<unknown, ApiError, void>({ mutationFn: () => gbp.unlink(id), onSuccess: done }),
  };
}

export function useMerchantListings(merchantId: string) {
  return useQuery({ queryKey: queryKeys.gbp.merchant(merchantId), queryFn: () => gbp.merchantListings(merchantId) });
}

export function useSampleData() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: queryKeys.gbp.all });
  return {
    load: useMutation<{ listings: number }, ApiError, void>({ mutationFn: () => gbp.loadSampleData(), onSettled: done }),
    remove: useMutation<{ removed: number }, ApiError, void>({ mutationFn: () => gbp.removeSampleData(), onSettled: done }),
  };
}
