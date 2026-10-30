"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { merchants } from "@/lib/api/resources/merchants";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError, PagedEnvelope } from "@/lib/api/client";
import type { MutationOpts, QueryOpts } from "@/lib/query/hook-types";
import type {
  Merchant,
  CreateMerchantInput,
  UpdateMerchantInput,
  MerchantListQuery,
} from "@/features/merchants/types";

/* Merchant query + mutation hooks.
   Errors are typed as ApiError everywhere (the client rejects with it), so
   `query.error` / mutation `onError(err)` are fully typed. Mutations own their
   cache invalidation and still forward a caller-supplied onSuccess/onError. */

/** GET /merchants — paginated list. `keepPreviousData` keeps the table steady
 *  while paging/filtering. */
export function useMerchants(query?: MerchantListQuery, options?: QueryOpts<PagedEnvelope<Merchant>>) {
  return useQuery<PagedEnvelope<Merchant>, ApiError>({
    queryKey: queryKeys.merchants.list(query ?? {}),
    queryFn: () => merchants.list(query),
    placeholderData: keepPreviousData,
    ...options,
  });
}

/** GET /merchants/:id — single merchant. Disabled until an id is present. */
export function useMerchant(id: string | undefined, options?: QueryOpts<Merchant>) {
  return useQuery<Merchant, ApiError>({
    queryKey: queryKeys.merchants.detail(id ?? ""),
    queryFn: () => merchants.get(id as string),
    enabled: !!id,
    ...options,
  });
}

/** POST /merchants — invalidates the list on success. */
export function useCreateMerchant(options?: MutationOpts<Merchant, CreateMerchantInput>) {
  const qc = useQueryClient();
  return useMutation<Merchant, ApiError, CreateMerchantInput>({
    mutationFn: (input) => merchants.create(input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      qc.invalidateQueries({ queryKey: queryKeys.merchants.lists() });
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}

/** PATCH /merchants/:id — writes the fresh record into the detail cache and
 *  invalidates the list. */
export function useUpdateMerchant(
  options?: MutationOpts<Merchant, { id: string; input: UpdateMerchantInput }>,
) {
  const qc = useQueryClient();
  return useMutation<Merchant, ApiError, { id: string; input: UpdateMerchantInput }>({
    mutationFn: ({ id, input }) => merchants.update(id, input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      qc.setQueryData(queryKeys.merchants.detail(vars.id), data);
      qc.invalidateQueries({ queryKey: queryKeys.merchants.lists() });
      // The patch may have filled or cleared a scored field (PROF-02). The
      // response already carries the recomputed percent, so the detail cache we
      // just wrote is correct — but completeness/alerts must be refetched.
      qc.invalidateQueries({ queryKey: queryKeys.merchants.completeness(vars.id), exact: true });
      qc.invalidateQueries({ queryKey: queryKeys.merchants.alerts(vars.id), exact: true });
      qc.invalidateQueries({ queryKey: queryKeys.merchants.profile(vars.id), exact: true });
      qc.invalidateQueries({ queryKey: queryKeys.merchants.fields(vars.id), exact: true });
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}

/** DELETE /merchants/:id — drops the detail cache and invalidates the list. */
export function useDeleteMerchant(options?: MutationOpts<void, string>) {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => merchants.remove(id),
    ...options,
    onSuccess: (data, id, ctx) => {
      qc.removeQueries({ queryKey: queryKeys.merchants.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.merchants.lists() });
      options?.onSuccess?.(data, id, ctx);
    },
  });
}
