"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { brandAssets } from "@/lib/api/resources/brand-assets";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { MutationOpts, QueryOpts } from "@/lib/query/hook-types";
import type { BrandAsset, UpdateBrandAssetInput, UploadBrandAssetInput } from "@/features/merchants/types";
import { invalidateProfileDerived } from "./invalidate-profile-derived";

/* Brand asset hooks. Every mutation invalidates the list AND the derived
   completeness views — assets are what the "files" section scores. */

export function useBrandAssets(merchantId: string | undefined, options?: QueryOpts<BrandAsset[]>) {
  return useQuery<BrandAsset[], ApiError>({
    queryKey: queryKeys.merchants.brandAssets(merchantId ?? ""),
    queryFn: () => brandAssets.list(merchantId as string),
    enabled: !!merchantId,
    ...options,
  });
}

export function useUploadBrandAsset(
  options?: MutationOpts<BrandAsset, { merchantId: string; file: File; input: UploadBrandAssetInput }>,
) {
  const qc = useQueryClient();
  return useMutation<BrandAsset, ApiError, { merchantId: string; file: File; input: UploadBrandAssetInput }>({
    mutationFn: ({ merchantId, file, input }) => brandAssets.upload(merchantId, file, input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      qc.invalidateQueries({ queryKey: queryKeys.merchants.brandAssets(vars.merchantId) });
      invalidateProfileDerived(qc, vars.merchantId);
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}

export function useUpdateBrandAsset(
  options?: MutationOpts<BrandAsset, { merchantId: string; id: string; input: UpdateBrandAssetInput }>,
) {
  const qc = useQueryClient();
  return useMutation<BrandAsset, ApiError, { merchantId: string; id: string; input: UpdateBrandAssetInput }>({
    mutationFn: ({ id, input }) => brandAssets.update(id, input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      qc.invalidateQueries({ queryKey: queryKeys.merchants.brandAssets(vars.merchantId) });
      invalidateProfileDerived(qc, vars.merchantId);
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}

export function useDeleteBrandAsset(options?: MutationOpts<void, { merchantId: string; id: string }>) {
  const qc = useQueryClient();
  return useMutation<void, ApiError, { merchantId: string; id: string }>({
    mutationFn: ({ id }) => brandAssets.remove(id),
    ...options,
    onSuccess: (data, vars, ctx) => {
      qc.invalidateQueries({ queryKey: queryKeys.merchants.brandAssets(vars.merchantId) });
      invalidateProfileDerived(qc, vars.merchantId);
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}
