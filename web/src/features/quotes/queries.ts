"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { quotes, type LinkQuery, type RequestQuery } from "@/lib/api/resources/quotes";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError, PagedEnvelope } from "@/lib/api/client";
import type { QueryOpts } from "@/lib/query/hook-types";
import type {
  CreateLinkInput,
  HardwarePlan,
  LinkCreated,
  PriceItem,
  PriceItemUpdate,
  QuoteLink,
  QuoteRequest,
  QuoteSummary,
  RequestStatus,
  Section,
  Selection,
  SignInput,
  UpdateLinkInput,
} from "./types";

export function usePriceList(options?: QueryOpts<PriceItem[]>) {
  return useQuery<PriceItem[], ApiError>({ queryKey: queryKeys.quotes.priceList(), queryFn: quotes.priceList, ...options });
}

export function useSections(options?: QueryOpts<Section[]>) {
  return useQuery<Section[], ApiError>({
    queryKey: queryKeys.quotes.sections(),
    queryFn: quotes.sections,
    staleTime: Infinity,
    ...options,
  });
}

export function useQuoteSummary(options?: QueryOpts<QuoteSummary>) {
  return useQuery<QuoteSummary, ApiError>({ queryKey: queryKeys.quotes.summary(), queryFn: quotes.summary, ...options });
}

export function useQuoteLinks(query: LinkQuery, options?: QueryOpts<PagedEnvelope<QuoteLink>>) {
  return useQuery<PagedEnvelope<QuoteLink>, ApiError>({
    queryKey: queryKeys.quotes.links(query),
    queryFn: () => quotes.links(query),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useQuoteLink(id: string | undefined, options?: QueryOpts<QuoteLink>) {
  return useQuery<QuoteLink, ApiError>({
    queryKey: queryKeys.quotes.link(id ?? ""),
    queryFn: () => quotes.link(id as string),
    enabled: !!id,
    ...options,
  });
}

export function useQuoteRequests(query: RequestQuery, options?: QueryOpts<PagedEnvelope<QuoteRequest>>) {
  return useQuery<PagedEnvelope<QuoteRequest>, ApiError>({
    queryKey: queryKeys.quotes.requests(query),
    queryFn: () => quotes.requests(query),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useQuoteRequest(id: string | undefined, options?: QueryOpts<QuoteRequest>) {
  return useQuery<QuoteRequest, ApiError>({
    queryKey: queryKeys.quotes.request(id ?? ""),
    queryFn: () => quotes.request(id as string),
    enabled: !!id,
    ...options,
  });
}

function useInvalidateQuotes() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: queryKeys.quotes.all });
}

export function useCreateLink() {
  const invalidate = useInvalidateQuotes();
  return useMutation<LinkCreated, ApiError, CreateLinkInput>({ mutationFn: quotes.createLink, onSuccess: invalidate });
}

export function useUpdateLink() {
  const invalidate = useInvalidateQuotes();
  return useMutation<QuoteLink, ApiError, { id: string; input: UpdateLinkInput }>({
    mutationFn: ({ id, input }) => quotes.updateLink(id, input),
    onSuccess: invalidate,
  });
}

export function useRevokeLink() {
  const invalidate = useInvalidateQuotes();
  return useMutation<QuoteLink, ApiError, string>({ mutationFn: quotes.revokeLink, onSuccess: invalidate });
}

export function useNewLinkUrl() {
  const invalidate = useInvalidateQuotes();
  return useMutation<LinkCreated, ApiError, string>({ mutationFn: quotes.newLinkUrl, onSuccess: invalidate });
}

export function useReviseRequest() {
  const invalidate = useInvalidateQuotes();
  return useMutation<QuoteRequest, ApiError, { id: string; items: Selection[]; hardwarePlan: HardwarePlan; note?: string; revealPrices?: boolean }>({
    mutationFn: ({ id, ...input }) => quotes.reviseRequest(id, input),
    onSuccess: invalidate,
  });
}

export function useCountersignRequest() {
  const invalidate = useInvalidateQuotes();
  return useMutation<QuoteRequest, ApiError, { id: string } & Omit<SignInput, "revisionNo">>({
    mutationFn: ({ id, ...input }) => quotes.countersignRequest(id, input),
    onSuccess: invalidate,
  });
}

export function useUpdateRequest() {
  const invalidate = useInvalidateQuotes();
  return useMutation<QuoteRequest, ApiError, { id: string; status?: RequestStatus; staffNote?: string | null }>({
    mutationFn: ({ id, ...input }) => quotes.updateRequest(id, input),
    onSuccess: invalidate,
  });
}

export function useUpdatePriceItem() {
  const invalidate = useInvalidateQuotes();
  return useMutation<PriceItem, ApiError, { id: string; input: PriceItemUpdate }>({
    mutationFn: ({ id, input }) => quotes.updatePriceItem(id, input),
    onSuccess: invalidate,
  });
}
