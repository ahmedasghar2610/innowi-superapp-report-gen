"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/query-keys";
import type {
  CreateWebsiteInput,
  LinkWebsiteInput,
  MerchantFromWebsiteInput,
  MerchantSuggestion,
  MerchantWebsites,
  UpdateWebsiteInput,
  Website,
  WebsiteLinkPreview,
  WebsiteListQuery,
  WebsiteListResponse,
  WebsitePrefill,
} from "../types";
import { websitesApi } from "./client";

/**
 * TanStack Query hooks for the Website Intake API.
 *
 * Keys live here rather than in the app-wide factory because this feature talks
 * to its own service; nothing outside `features/websites` needs to invalidate
 * them.
 */
export const websiteKeys = {
  all: ["websites"] as const,
  lists: () => [...websiteKeys.all, "list"] as const,
  list: (query: object = {}) => [...websiteKeys.lists(), query] as const,
  detail: (id: string) => [...websiteKeys.all, "detail", id] as const,
  suggestions: (id: string) => [...websiteKeys.all, "suggestions", id] as const,
  linkPreview: (id: string, merchantId: string) => [...websiteKeys.all, "link-preview", id, merchantId] as const,
  forMerchant: (merchantId: string) => [...websiteKeys.all, "merchant", merchantId] as const,
  prefill: (merchantId: string) => [...websiteKeys.all, "prefill", merchantId] as const,
};

/** The websites list, filtered server-side. */
export function useWebsites(query: WebsiteListQuery = {}) {
  return useQuery<WebsiteListResponse, ApiError>({
    queryKey: websiteKeys.list(query),
    queryFn: () => websitesApi.list(query),
    // Filters change as you type — keep the previous page on screen instead of
    // flashing the skeleton between keystrokes.
    placeholderData: (previous) => previous,
  });
}

export function useWebsite(id: string | undefined) {
  return useQuery<Website, ApiError>({
    queryKey: websiteKeys.detail(id ?? ""),
    queryFn: () => websitesApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateWebsite() {
  const qc = useQueryClient();
  return useMutation<Website, ApiError, CreateWebsiteInput>({
    mutationFn: (input) => websitesApi.create(input),
    onSuccess: (website) => {
      qc.setQueryData(websiteKeys.detail(website.id), website);
      void qc.invalidateQueries({ queryKey: websiteKeys.lists() });
    },
  });
}

export function useUpdateWebsite() {
  const qc = useQueryClient();
  return useMutation<Website, ApiError, { id: string; input: UpdateWebsiteInput }>({
    mutationFn: ({ id, input }) => websitesApi.update(id, input),
    onSuccess: (website) => {
      qc.setQueryData(websiteKeys.detail(website.id), website);
      void qc.invalidateQueries({ queryKey: websiteKeys.lists() });
      if (website.merchantId) {
        // Linked site: name / phone / address / hours saved in the form are
        // written to the merchant Profile (and its URL) — refresh that merchant.
        void qc.invalidateQueries({ queryKey: queryKeys.merchants.detail(website.merchantId) });
        void qc.invalidateQueries({ queryKey: queryKeys.merchants.lists() });
        void qc.invalidateQueries({ queryKey: websiteKeys.forMerchant(website.merchantId) });
      }
    },
  });
}

/** "Rebuild from form" — drop the /admin edits. */
export function useRebuildFromForm() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => websitesApi.rebuildFromForm(id),
    onSuccess: (_void, id) => {
      void qc.invalidateQueries({ queryKey: websiteKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: websiteKeys.lists() });
    },
  });
}

export function useDeleteWebsite() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => websitesApi.remove(id),
    onSuccess: (_void, id) => {
      qc.removeQueries({ queryKey: websiteKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: websiteKeys.lists() });
    },
  });
}

/* ------------------------------------------------------------ merchant link */

/** After any link change: the site, every list, this merchant's tab, and the merchant itself (websiteUrl). */
function invalidateLink(qc: ReturnType<typeof useQueryClient>, website: Website, previousMerchantId?: string | null) {
  qc.setQueryData(websiteKeys.detail(website.id), website);
  void qc.invalidateQueries({ queryKey: websiteKeys.lists() });
  for (const mid of [website.merchantId, previousMerchantId]) {
    if (!mid) continue;
    void qc.invalidateQueries({ queryKey: websiteKeys.forMerchant(mid) });
    void qc.invalidateQueries({ queryKey: queryKeys.merchants.detail(mid) });
  }
  void qc.invalidateQueries({ queryKey: queryKeys.merchants.lists() });
}

export function useMerchantSuggestions(websiteId: string | undefined) {
  return useQuery<MerchantSuggestion[], ApiError>({
    queryKey: websiteKeys.suggestions(websiteId ?? ""),
    queryFn: () => websitesApi.merchantSuggestions(websiteId as string),
    enabled: Boolean(websiteId),
  });
}

export function useLinkPreview(websiteId: string | undefined, merchantId: string | undefined) {
  return useQuery<WebsiteLinkPreview, ApiError>({
    queryKey: websiteKeys.linkPreview(websiteId ?? "", merchantId ?? ""),
    queryFn: () => websitesApi.linkPreview(websiteId as string, merchantId as string),
    enabled: Boolean(websiteId && merchantId),
  });
}

export function useLinkWebsite() {
  const qc = useQueryClient();
  return useMutation<Website, ApiError, { id: string; input: LinkWebsiteInput }>({
    mutationFn: ({ id, input }) => websitesApi.link(id, input),
    onSuccess: (website) => invalidateLink(qc, website),
  });
}

export function useUnlinkWebsite() {
  const qc = useQueryClient();
  return useMutation<Website, ApiError, { id: string; previousMerchantId: string | null | undefined }>({
    mutationFn: ({ id }) => websitesApi.unlink(id),
    onSuccess: (website, vars) => invalidateLink(qc, website, vars.previousMerchantId),
  });
}

export function useCreateMerchantFromWebsite() {
  const qc = useQueryClient();
  return useMutation<Website, ApiError, { id: string; input?: MerchantFromWebsiteInput }>({
    mutationFn: ({ id, input }) => websitesApi.createMerchant(id, input),
    onSuccess: (website) => invalidateLink(qc, website),
  });
}

/** The workspace Website tab: none / external / managed. */
export function useMerchantWebsites(merchantId: string | undefined) {
  return useQuery<MerchantWebsites, ApiError>({
    queryKey: websiteKeys.forMerchant(merchantId ?? ""),
    queryFn: () => websitesApi.forMerchant(merchantId as string),
    enabled: Boolean(merchantId),
  });
}

/** Starter answers for a new site, from the merchant Profile. */
export function useWebsitePrefill(merchantId: string | undefined) {
  return useQuery<WebsitePrefill, ApiError>({
    queryKey: websiteKeys.prefill(merchantId ?? ""),
    queryFn: () => websitesApi.prefill(merchantId as string),
    enabled: Boolean(merchantId),
  });
}
