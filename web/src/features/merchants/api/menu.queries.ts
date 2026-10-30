"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { menu } from "@/lib/api/resources/menu";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { MutationOpts, QueryOpts } from "@/lib/query/hook-types";
import type { ExtractMenuInput, MenuSummary, MerchantMenu } from "@/features/merchants/types";

export function useMerchantMenu(merchantId: string | undefined, options?: QueryOpts<MerchantMenu>) {
  return useQuery<MerchantMenu, ApiError>({
    queryKey: queryKeys.merchants.menu(merchantId ?? ""),
    queryFn: () => menu.get(merchantId as string),
    enabled: !!merchantId,
    // Poll while an extraction is running in the background.
    refetchInterval: (query) => (query.state.data?.lastStatus === "RUNNING" ? 1500 : false),
    ...options,
  });
}

/** Starts an extraction (it runs in the background). Refetching the menu picks
 *  up RUNNING, which turns on polling; MenuPanel refreshes the merchant views
 *  when the run finishes (the link may be saved to "Online ordering"). */
export function useExtractMenu(options?: MutationOpts<MenuSummary, { merchantId: string; input: ExtractMenuInput }>) {
  const qc = useQueryClient();
  return useMutation<MenuSummary, ApiError, { merchantId: string; input: ExtractMenuInput }>({
    mutationFn: ({ merchantId, input }) => menu.extract(merchantId, input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      qc.setQueryData<MerchantMenu>(queryKeys.merchants.menu(vars.merchantId), (old) =>
        old ? { ...old, ...data } : old,
      );
      qc.invalidateQueries({ queryKey: queryKeys.merchants.menu(vars.merchantId) });
      options?.onSuccess?.(data, vars, ctx);
    },
    onError: (err, vars, ctx) => {
      // A failed run is recorded on the menu (lastError) — refresh to show it.
      qc.invalidateQueries({ queryKey: queryKeys.merchants.menu(vars.merchantId) });
      options?.onError?.(err, vars, ctx);
    },
  });
}
