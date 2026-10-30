"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountManagers } from "@/lib/api/resources/account-managers";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { MutationOpts, QueryOpts } from "@/lib/query/hook-types";
import type {
  AccountManager,
  CreateAccountManagerInput,
  UpdateAccountManagerInput,
} from "@/features/merchants/types";

/* Account manager hooks. The list is small and changes rarely, so it is cached
   for five minutes — it feeds the directory filter and the merchant form picker. */

export function useAccountManagers(options?: QueryOpts<AccountManager[]>) {
  return useQuery<AccountManager[], ApiError>({
    queryKey: queryKeys.accountManagers.list(),
    queryFn: () => accountManagers.list(),
    staleTime: 5 * 60_000,
    ...options,
  });
}

export function useCreateAccountManager(options?: MutationOpts<AccountManager, CreateAccountManagerInput>) {
  const qc = useQueryClient();
  return useMutation<AccountManager, ApiError, CreateAccountManagerInput>({
    mutationFn: (input) => accountManagers.create(input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      qc.invalidateQueries({ queryKey: queryKeys.accountManagers.all });
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}

export function useUpdateAccountManager(
  options?: MutationOpts<AccountManager, { id: string; input: UpdateAccountManagerInput }>,
) {
  const qc = useQueryClient();
  return useMutation<AccountManager, ApiError, { id: string; input: UpdateAccountManagerInput }>({
    mutationFn: ({ id, input }) => accountManagers.update(id, input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      qc.invalidateQueries({ queryKey: queryKeys.accountManagers.all });
      // Merchant rows embed { id, name } — a rename must reach the directory too.
      qc.invalidateQueries({ queryKey: queryKeys.merchants.all });
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}
