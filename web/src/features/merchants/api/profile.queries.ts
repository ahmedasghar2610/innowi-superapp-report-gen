"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { profileFields } from "@/lib/api/resources/profile-fields";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { MutationOpts, QueryOpts } from "@/lib/query/hook-types";
import { invalidateProfileDerived } from "./invalidate-profile-derived";
import type {
  MerchantProfile,
  ProfileField,
  ProfileFieldsResponse,
  UpdateProfileFieldInput,
  AttestFieldInput,
} from "@/features/merchants/types";

/**
 * GET /merchants/:id/profile — merchant record + the full server-driven field
 * registry in one call. Handy when a screen needs both; the Profile tab itself
 * uses `useProfileFields` since the workspace shell already holds the merchant.
 */
export function useMerchantProfile(id: string | undefined, options?: QueryOpts<MerchantProfile>) {
  return useQuery<MerchantProfile, ApiError>({
    queryKey: queryKeys.merchants.profile(id ?? ""),
    queryFn: () => profileFields.getProfile(id as string),
    enabled: !!id,
    ...options,
  });
}

/**
 * GET /merchants/:id/fields — the flat, server-ordered field registry plus a
 * completion summary (PROF-02/03). Returns the full `{ data, completion }`
 * envelope (not just the array) so the Profile tab can render section
 * grouping and missing-field surfacing without a second request.
 */
export function useProfileFields(id: string | undefined, options?: QueryOpts<ProfileFieldsResponse>) {
  return useQuery<ProfileFieldsResponse, ApiError>({
    queryKey: queryKeys.merchants.fields(id ?? ""),
    queryFn: () => profileFields.list(id as string),
    enabled: !!id,
    ...options,
  });
}

/**
 * PATCH /merchants/:id/fields/:key — update one field's value (and optionally
 * its verification metadata). On success we write the returned field straight
 * into the fields cache and invalidate the merchant record + profile, because a
 * field edit also changes the underlying Merchant row (header/summary reflect it).
 */
/**
 * POST /merchants/:id/fields/:key/attest — Verify / Mark outdated / Mark
 * placeholder. Same cache handling as an update: the returned field is patched
 * in place and the derived views are invalidated (PLACEHOLDER moves the score).
 */
export function useAttestField(
  options?: MutationOpts<ProfileField, { merchantId: string; key: string; input: AttestFieldInput }>,
) {
  const qc = useQueryClient();
  return useMutation<ProfileField, ApiError, { merchantId: string; key: string; input: AttestFieldInput }>({
    mutationFn: ({ merchantId, key, input }) => profileFields.attest(merchantId, key, input),
    ...options,
    onSuccess: (updated, vars, ctx) => {
      qc.setQueryData<ProfileFieldsResponse>(queryKeys.merchants.fields(vars.merchantId), (prev) =>
        prev ? { ...prev, data: prev.data.map((f) => (f.key === updated.key ? updated : f)) } : prev,
      );
      qc.invalidateQueries({ queryKey: queryKeys.merchants.profile(vars.merchantId), exact: true });
      qc.invalidateQueries({ queryKey: queryKeys.merchants.fields(vars.merchantId), exact: true });
      invalidateProfileDerived(qc, vars.merchantId);
      options?.onSuccess?.(updated, vars, ctx);
    },
  });
}

export function useUpdateProfileField(
  options?: MutationOpts<ProfileField, { merchantId: string; key: string; input: UpdateProfileFieldInput }>,
) {
  const qc = useQueryClient();
  return useMutation<
    ProfileField,
    ApiError,
    { merchantId: string; key: string; input: UpdateProfileFieldInput }
  >({
    mutationFn: ({ merchantId, key, input }) => profileFields.update(merchantId, key, input),
    ...options,
    onSuccess: (updated, vars, ctx) => {
      // Patch the single field in place so the row updates without a refetch.
      // `completion` is left as-is here (a stale percent for one tick is fine)
      // since the invalidations below refetch it along with the merchant record.
      qc.setQueryData<ProfileFieldsResponse>(queryKeys.merchants.fields(vars.merchantId), (prev) =>
        prev ? { ...prev, data: prev.data.map((f) => (f.key === updated.key ? updated : f)) } : prev,
      );
      // The value lives on the Merchant row → refresh just the merchant record
      // (`exact` so we don't also refetch every sibling collection, since
      // `detail(id)` is their shared key prefix), the combined profile query,
      // and the fields query itself so `completion` catches up.
      qc.invalidateQueries({ queryKey: queryKeys.merchants.profile(vars.merchantId), exact: true });
      qc.invalidateQueries({ queryKey: queryKeys.merchants.fields(vars.merchantId), exact: true });
      // A field edit can close (or open) a Missing Information gap and move the
      // score, so the derived views and the cached percent go too.
      invalidateProfileDerived(qc, vars.merchantId);
      options?.onSuccess?.(updated, vars, ctx);
    },
  });
}
