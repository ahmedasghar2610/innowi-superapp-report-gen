"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { brandProfile } from "@/lib/api/resources/brand-profile";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { MutationOpts, QueryOpts } from "@/lib/query/hook-types";
import type { BrandProfile, UpsertBrandProfileInput } from "@/features/merchants/types";
import { invalidateProfileDerived } from "./invalidate-profile-derived";

/* Brand profile hooks — a 1:1 resource, so no list/delete and the upsert writes
   the fresh row straight into the cache instead of invalidating a list. The
   brand profile is a scored completeness section (Step 5), so the upsert also
   invalidates the derived completeness/alerts views like every other scored
   write. */

export function useBrandProfile(merchantId: string | undefined, options?: QueryOpts<BrandProfile>) {
  return useQuery<BrandProfile, ApiError>({
    queryKey: queryKeys.merchants.brandProfile(merchantId ?? ""),
    queryFn: () => brandProfile.get(merchantId as string),
    enabled: !!merchantId,
    ...options,
  });
}

export function useUpsertBrandProfile(
  options?: MutationOpts<BrandProfile, { merchantId: string; input: UpsertBrandProfileInput }>,
) {
  const qc = useQueryClient();
  return useMutation<BrandProfile, ApiError, { merchantId: string; input: UpsertBrandProfileInput }>({
    mutationFn: ({ merchantId, input }) => brandProfile.upsert(merchantId, input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      qc.setQueryData(queryKeys.merchants.brandProfile(vars.merchantId), data);
      invalidateProfileDerived(qc, vars.merchantId);
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}
