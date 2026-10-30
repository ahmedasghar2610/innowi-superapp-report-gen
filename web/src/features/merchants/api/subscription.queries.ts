"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { subscription } from "@/lib/api/resources/subscription";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { MutationOpts } from "@/lib/query/hook-types";
import type { MerchantSubscription, UpsertSubscriptionInput } from "@/features/merchants/types";

/* Subscription write hook. The merchant record embeds the subscription, so on
   success the merchant detail and the directory list are invalidated (both
   render package / status / MRR) — there is no separate subscription cache. */
export function useUpsertSubscription(
  options?: MutationOpts<MerchantSubscription, { merchantId: string; input: UpsertSubscriptionInput }>,
) {
  const qc = useQueryClient();
  return useMutation<MerchantSubscription, ApiError, { merchantId: string; input: UpsertSubscriptionInput }>({
    mutationFn: ({ merchantId, input }) => subscription.upsert(merchantId, input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      qc.invalidateQueries({ queryKey: queryKeys.merchants.detail(vars.merchantId) });
      qc.invalidateQueries({ queryKey: queryKeys.merchants.lists() });
      qc.invalidateQueries({ queryKey: queryKeys.profiling.all });
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}
