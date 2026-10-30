"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/client";
import type { MutationOpts, QueryOpts } from "@/lib/query/hook-types";
import { invalidateProfileDerived } from "./invalidate-profile-derived";

/**
 * Factory for a merchant child-resource's query + mutation hooks. Contacts,
 * locations, connections, documents and services all share the exact same shape:
 *   - list/create are nested under the merchant (`/merchants/:id/<resource>`)
 *   - update/delete are flat item routes (`/<resource>/:id`)
 *   - every mutation invalidates that merchant's list on success, plus the
 *     server-derived completeness/alerts views (contacts, locations, documents
 *     and connections are all scored sections — see `invalidateProfileDerived`)
 * so they're generated from one definition instead of five ~70-line files.
 *
 * The produced hooks keep the established variable shapes — create takes
 * `{ merchantId, input }`, update `{ merchantId, id, input }`, delete
 * `{ merchantId, id }` (merchantId is carried so the right list is invalidated,
 * since item routes are flat) — so callers are unchanged.
 */
export interface ChildResourceDef<T, CreateInput, UpdateInput> {
  /** Query-key factory for this resource's list, e.g. `queryKeys.merchants.contacts`. */
  key: (merchantId: string) => readonly unknown[];
  list: (merchantId: string) => Promise<T[]>;
  create: (merchantId: string, input: CreateInput) => Promise<T>;
  update: (id: string, input: UpdateInput) => Promise<T>;
  remove: (id: string) => Promise<void>;
}

export interface CreateVars<CreateInput> {
  merchantId: string;
  input: CreateInput;
}
export interface UpdateVars<UpdateInput> {
  merchantId: string;
  id: string;
  input: UpdateInput;
}
export interface DeleteVars {
  merchantId: string;
  id: string;
}

export function createChildResourceHooks<T, CreateInput, UpdateInput>(
  def: ChildResourceDef<T, CreateInput, UpdateInput>,
) {
  function useList(merchantId: string | undefined, options?: QueryOpts<T[]>) {
    return useQuery<T[], ApiError>({
      queryKey: def.key(merchantId ?? ""),
      queryFn: () => def.list(merchantId as string),
      enabled: !!merchantId,
      ...options,
    });
  }

  function useCreate(options?: MutationOpts<T, CreateVars<CreateInput>>) {
    const qc = useQueryClient();
    return useMutation<T, ApiError, CreateVars<CreateInput>>({
      mutationFn: ({ merchantId, input }) => def.create(merchantId, input),
      ...options,
      onSuccess: (data, vars, ctx) => {
        qc.invalidateQueries({ queryKey: def.key(vars.merchantId) });
        invalidateProfileDerived(qc, vars.merchantId);
        options?.onSuccess?.(data, vars, ctx);
      },
    });
  }

  function useUpdate(options?: MutationOpts<T, UpdateVars<UpdateInput>>) {
    const qc = useQueryClient();
    return useMutation<T, ApiError, UpdateVars<UpdateInput>>({
      mutationFn: ({ id, input }) => def.update(id, input),
      ...options,
      onSuccess: (data, vars, ctx) => {
        qc.invalidateQueries({ queryKey: def.key(vars.merchantId) });
        invalidateProfileDerived(qc, vars.merchantId);
        options?.onSuccess?.(data, vars, ctx);
      },
    });
  }

  function useDelete(options?: MutationOpts<void, DeleteVars>) {
    const qc = useQueryClient();
    return useMutation<void, ApiError, DeleteVars>({
      mutationFn: ({ id }) => def.remove(id),
      ...options,
      onSuccess: (data, vars, ctx) => {
        qc.invalidateQueries({ queryKey: def.key(vars.merchantId) });
        invalidateProfileDerived(qc, vars.merchantId);
        options?.onSuccess?.(data, vars, ctx);
      },
    });
  }

  return { useList, useCreate, useUpdate, useDelete };
}
