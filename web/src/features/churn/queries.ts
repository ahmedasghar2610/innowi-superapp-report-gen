"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { churn } from "@/lib/api/resources/churn";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError, PagedEnvelope } from "@/lib/api/client";
import type { QueryOpts } from "@/lib/query/hook-types";
import type { ChurnDetail, ChurnImportReport, ChurnQuery, ChurnRow, ChurnSummary, MarkChurnedInput, UpdateChurnInput } from "./types";

export function useChurnList(query?: ChurnQuery, options?: QueryOpts<PagedEnvelope<ChurnRow>>) {
  return useQuery<PagedEnvelope<ChurnRow>, ApiError>({
    queryKey: queryKeys.churn.list(query ?? {}),
    queryFn: () => churn.list(query),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useChurnSummary(options?: QueryOpts<ChurnSummary>) {
  return useQuery<ChurnSummary, ApiError>({ queryKey: queryKeys.churn.summary(), queryFn: churn.summary, ...options });
}

export function useChurnDetail(merchantId?: string, options?: QueryOpts<ChurnDetail>) {
  return useQuery<ChurnDetail, ApiError>({
    queryKey: queryKeys.churn.detail(merchantId ?? ""),
    queryFn: () => churn.get(merchantId!),
    enabled: !!merchantId,
    ...options,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return (merchantId?: string) => {
    qc.invalidateQueries({ queryKey: queryKeys.churn.lists() });
    qc.invalidateQueries({ queryKey: queryKeys.churn.summary() });
    if (merchantId) qc.invalidateQueries({ queryKey: queryKeys.churn.detail(merchantId) });
    qc.invalidateQueries({ queryKey: queryKeys.merchants.all });
  };
}

export function useUpdateChurn() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation<ChurnDetail, ApiError, { merchantId: string; input: UpdateChurnInput }>({
    mutationFn: ({ merchantId, input }) => churn.update(merchantId, input),
    onSuccess: (detail) => {
      qc.setQueryData(queryKeys.churn.detail(detail.merchantId), detail);
      invalidate(detail.merchantId);
    },
  });
}

export function useAddChurnNote() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation<ChurnDetail, ApiError, { merchantId: string; body: string }>({
    mutationFn: ({ merchantId, body }) => churn.addNote(merchantId, body),
    onSuccess: (detail) => {
      qc.setQueryData(queryKeys.churn.detail(detail.merchantId), detail);
      invalidate(detail.merchantId);
    },
  });
}

export function useMarkChurned() {
  const invalidate = useInvalidate();
  return useMutation<ChurnDetail, ApiError, { merchantId: string; input: MarkChurnedInput }>({
    mutationFn: ({ merchantId, input }) => churn.mark(merchantId, input),
    onSuccess: (detail) => invalidate(detail.merchantId),
  });
}

export function useImportChurn() {
  const invalidate = useInvalidate();
  return useMutation<ChurnImportReport, ApiError, { file: File; dryRun: boolean }>({
    mutationFn: ({ file, dryRun }) => churn.import(file, dryRun),
    onSuccess: (report) => {
      if (!report.dryRun) invalidate();
    },
  });
}
