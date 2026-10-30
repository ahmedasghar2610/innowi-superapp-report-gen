"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cateringProfile } from "@/lib/api/resources/catering-profile";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { MutationOpts, QueryOpts } from "@/lib/query/hook-types";
import type { CateringProfile, UpsertCateringProfileInput } from "@/features/merchants/types";

/* Catering profile hooks — same 1:1 shape as brand profile. */

export function useCateringProfile(merchantId: string | undefined, options?: QueryOpts<CateringProfile>) {
  return useQuery<CateringProfile, ApiError>({
    queryKey: queryKeys.merchants.cateringProfile(merchantId ?? ""),
    queryFn: () => cateringProfile.get(merchantId as string),
    enabled: !!merchantId,
    ...options,
  });
}

export function useUpsertCateringProfile(
  options?: MutationOpts<CateringProfile, { merchantId: string; input: UpsertCateringProfileInput }>,
) {
  const qc = useQueryClient();
  return useMutation<CateringProfile, ApiError, { merchantId: string; input: UpsertCateringProfileInput }>({
    mutationFn: ({ merchantId, input }) => cateringProfile.upsert(merchantId, input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      qc.setQueryData(queryKeys.merchants.cateringProfile(vars.merchantId), data);
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}
