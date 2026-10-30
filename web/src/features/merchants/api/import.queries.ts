"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/client";
import { merchantMenus, merchants } from "@/lib/api/resources/merchants";
import { queryKeys } from "@/lib/query/query-keys";
import type { ImportDecisions, ImportReport, MenuFetchResult, MenuStatusRow } from "../types";

/** POST /merchants/import — preview (dryRun) or apply; applying refreshes every merchant list and profile. */
export function useImportMerchants() {
  const qc = useQueryClient();
  return useMutation<ImportReport, ApiError, { file: File; dryRun: boolean; decisions?: ImportDecisions }>({
    mutationFn: ({ file, dryRun, decisions }) => merchants.importFile(file, dryRun, decisions),
    onSuccess: (_d, vars) => {
      if (!vars.dryRun) void qc.invalidateQueries({ queryKey: queryKeys.merchants.all });
    },
  });
}

/** Menu status of these merchants (all merchants without ids). Polls every 4 s while any is queued or running. */
export function useMenuStatuses(ids: string[] | undefined, enabled = true) {
  const key = ids ? [...ids].sort().join(",") : "all";
  return useQuery<{ data: MenuStatusRow[]; counts: Record<string, number> }, ApiError>({
    queryKey: queryKeys.merchants.menus(key),
    queryFn: () => merchantMenus.status(ids),
    enabled,
    refetchInterval: (q) => (q.state.data?.data.some((r) => r.status === "running" || r.status === "queued") ? 4000 : false),
  });
}

export function useCheckMenus() {
  return useMutation<{ data: MenuStatusRow[] }, ApiError, string[]>({ mutationFn: (ids) => merchantMenus.check(ids) });
}

export function useFetchMenus() {
  const qc = useQueryClient();
  return useMutation<MenuFetchResult, ApiError, string[]>({
    mutationFn: (ids) => merchantMenus.fetch(ids),
    onSettled: () => qc.invalidateQueries({ queryKey: [...queryKeys.merchants.all, "menus"] }),
  });
}

export function usePickMenuLink() {
  const qc = useQueryClient();
  return useMutation<MenuStatusRow, ApiError, { merchantId: string; link: string }>({
    mutationFn: ({ merchantId, link }) => merchantMenus.pickLink(merchantId, link),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: [...queryKeys.merchants.all, "menus"] });
      void qc.invalidateQueries({ queryKey: queryKeys.merchants.menu(v.merchantId) });
    },
  });
}
