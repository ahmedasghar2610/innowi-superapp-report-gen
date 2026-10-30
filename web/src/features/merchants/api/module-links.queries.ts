/**
 * The merchant connector (API: app/modules/linking/connector*.py) — each merchant's
 * SEO sites, Google Ads accounts and GBP listings: linked, suggested, link / unlink,
 * search, and "Connect" (link the sure matches).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/query-keys";

export type LinkModule = "seo" | "ads" | "gbp";
export interface LinkedRecord {
  id: string;
  name: string;
  detail: string | null;
  url?: string;
  state?: string;
}
export interface LinkSuggestion extends LinkedRecord {
  score: number;
  reasons: string[];
  sure: boolean;
}
export interface ModuleLinks {
  enabled: boolean;
  linked: LinkedRecord[];
  suggestions: LinkSuggestion[];
}
export interface MerchantLinks {
  settings: { modules: Record<LinkModule | "website", boolean>; autoLinkSure: boolean };
  modules: Record<LinkModule, ModuleLinks>;
}
export interface ConnectResult {
  skipped: boolean;
  id?: string;
  summary: Record<string, number>;
}

const key = (merchantId: string) => [...queryKeys.merchants.all, merchantId, "module-links"] as const;

/** Everything a merchant's links touch: its tabs, the modules' own pages, Data setup. */
function useInvalidateLinks() {
  const qc = useQueryClient();
  return () => {
    for (const k of [queryKeys.merchants.all, queryKeys.seo.all, queryKeys.ads.all, queryKeys.gbp.all, queryKeys.settings.all]) {
      void qc.invalidateQueries({ queryKey: k });
    }
  };
}

export function useMerchantLinks(merchantId: string) {
  return useQuery<MerchantLinks, ApiError>({
    queryKey: key(merchantId),
    queryFn: () => api.get<MerchantLinks>(`/merchants/${merchantId}/links`),
  });
}

export function useLinkSearch(merchantId: string, module: LinkModule, q: string, enabled: boolean) {
  return useQuery<{ data: LinkedRecord[] }, ApiError>({
    queryKey: [...key(merchantId), "search", module, q],
    queryFn: () => api.get(`/merchants/${merchantId}/links/search?module=${module}&q=${encodeURIComponent(q)}`),
    enabled,
    staleTime: 10_000,
  });
}

export function useLinkRecord(merchantId: string) {
  const invalidate = useInvalidateLinks();
  return useMutation<LinkedRecord, ApiError, { module: LinkModule; entityId: string }>({
    mutationFn: (body) => api.post(`/merchants/${merchantId}/links`, body),
    onSuccess: invalidate,
  });
}

export function useUnlinkRecord(merchantId: string) {
  const invalidate = useInvalidateLinks();
  return useMutation<void, ApiError, { module: LinkModule; entityId: string }>({
    mutationFn: ({ module, entityId }) => api.del(`/merchants/${merchantId}/links/${module}/${entityId}`),
    onSuccess: invalidate,
  });
}

/** Link the sure matches for these merchants (omitted = every merchant). */
export function useConnectMerchants() {
  const invalidate = useInvalidateLinks();
  return useMutation<ConnectResult, ApiError, string[] | undefined>({
    mutationFn: (merchantIds) => api.post("/merchants/connect", merchantIds ? { merchantIds } : {}),
    onSuccess: invalidate,
  });
}

/** "2 SEO sites · 1 Ads account" for a toast. */
export function describeConnect(s: Record<string, number>): string {
  return (
    [s.seo && `${s.seo} SEO site${s.seo === 1 ? "" : "s"}`, s.ads && `${s.ads} Ads account${s.ads === 1 ? "" : "s"}`,
      s.gbp && `${s.gbp} GBP listing${s.gbp === 1 ? "" : "s"}`, s.website && `${s.website} website${s.website === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" · ") || "Nothing new to link"
  );
}
