"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sales } from "@/lib/api/resources/sales";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { QueryOpts } from "@/lib/query/hook-types";
import type {
  CaseFilters,
  CaseInsights,
  CasePage,
  CaseQuery,
  CreatedLogin,
  CustomerDetail,
  CustomerPage,
  CustomerQuery,
  DealDetail,
  DealPage,
  DealQuery,
  Owner,
  OwnerQuery,
  Person,
  Pipeline,
  PipelineQuery,
  SalesMe,
  SalesRole,
  Summary,
  Insights,
  SyncRun,
  SyncStatus,
  TeamMember,
  VisitPage,
  VisitQuery,
} from "./types";

/**
 * Sales data changes only when the sync runs (every ~15 minutes), so a
 * minute of staleness costs nothing and saves refetching on every tab switch.
 */
const SALES_STALE_TIME = 60_000;

export function useSalesMe(options?: QueryOpts<SalesMe>) {
  return useQuery<SalesMe, ApiError>({
    queryKey: queryKeys.sales.me(),
    queryFn: () => sales.me(),
    staleTime: SALES_STALE_TIME,
    ...options,
  });
}

export function useSalesSummary(query: OwnerQuery, options?: QueryOpts<Summary>) {
  return useQuery<Summary, ApiError>({
    queryKey: queryKeys.sales.summary(query),
    queryFn: () => sales.summary(query),
    staleTime: SALES_STALE_TIME,
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useInsights(query: OwnerQuery, options?: QueryOpts<Insights>) {
  return useQuery<Insights, ApiError>({
    queryKey: queryKeys.sales.insights(query),
    queryFn: () => sales.insights(query),
    staleTime: SALES_STALE_TIME,
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function usePipeline(query: PipelineQuery, options?: QueryOpts<Pipeline>) {
  return useQuery<Pipeline, ApiError>({
    queryKey: queryKeys.sales.pipeline(query),
    queryFn: () => sales.pipeline(query),
    staleTime: SALES_STALE_TIME,
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useDeals(query: DealQuery, options?: QueryOpts<DealPage>) {
  return useQuery<DealPage, ApiError>({
    queryKey: queryKeys.sales.deals(query),
    queryFn: () => sales.deals(query),
    staleTime: SALES_STALE_TIME,
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useDeal(id: string | undefined, options?: QueryOpts<DealDetail>) {
  return useQuery<DealDetail, ApiError>({
    queryKey: queryKeys.sales.deal(id ?? ""),
    queryFn: () => sales.deal(id as string),
    enabled: !!id,
    staleTime: SALES_STALE_TIME,
    ...options,
  });
}

export function useCustomers(query: CustomerQuery, options?: QueryOpts<CustomerPage>) {
  return useQuery<CustomerPage, ApiError>({
    queryKey: queryKeys.sales.customers(query),
    queryFn: () => sales.customers(query),
    staleTime: SALES_STALE_TIME,
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useCustomer(id: string | undefined, options?: QueryOpts<CustomerDetail>) {
  return useQuery<CustomerDetail, ApiError>({
    queryKey: queryKeys.sales.customer(id ?? ""),
    queryFn: () => sales.customer(id as string),
    enabled: !!id,
    staleTime: SALES_STALE_TIME,
    ...options,
  });
}

export function useVisits(query: VisitQuery, options?: QueryOpts<VisitPage>) {
  return useQuery<VisitPage, ApiError>({
    queryKey: queryKeys.sales.visits(query),
    queryFn: () => sales.visits(query),
    staleTime: SALES_STALE_TIME,
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useVisitTypes(options?: QueryOpts<string[]>) {
  return useQuery<string[], ApiError>({
    queryKey: queryKeys.sales.visitTypes(),
    queryFn: () => sales.visitTypes(),
    staleTime: 10 * 60_000,
    ...options,
  });
}

export function useCases(query: CaseQuery, options?: QueryOpts<CasePage>) {
  return useQuery<CasePage, ApiError>({
    queryKey: queryKeys.sales.cases(query),
    queryFn: () => sales.cases(query),
    staleTime: SALES_STALE_TIME,
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useCaseInsights(query: OwnerQuery & CaseFilters, options?: QueryOpts<CaseInsights>) {
  return useQuery<CaseInsights, ApiError>({
    queryKey: queryKeys.sales.caseInsights(query),
    queryFn: () => sales.caseInsights(query),
    staleTime: SALES_STALE_TIME,
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useOwners(options?: QueryOpts<Owner[]>) {
  return useQuery<Owner[], ApiError>({
    queryKey: queryKeys.sales.owners(),
    queryFn: () => sales.owners(),
    staleTime: 10 * 60_000,
    ...options,
  });
}

export function useTeam(options?: QueryOpts<TeamMember[]>) {
  return useQuery<TeamMember[], ApiError>({
    queryKey: queryKeys.sales.team(),
    queryFn: () => sales.team(),
    staleTime: SALES_STALE_TIME,
    ...options,
  });
}

export function usePeople(options?: QueryOpts<Person[]>) {
  return useQuery<Person[], ApiError>({
    queryKey: queryKeys.sales.people(),
    queryFn: () => sales.people(),
    ...options,
  });
}

export function useSyncStatus(options?: QueryOpts<SyncStatus>) {
  return useQuery<SyncStatus, ApiError>({
    queryKey: queryKeys.sales.sync(),
    queryFn: () => sales.syncStatus(),
    ...options,
  });
}

export function useCreateLogin() {
  const qc = useQueryClient();
  return useMutation<CreatedLogin, ApiError, { sfUserId: string; role: SalesRole; email?: string }>({
    mutationFn: ({ sfUserId, role, email }) => sales.createLogin(sfUserId, { role, email: email || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sales.people() });
      qc.invalidateQueries({ queryKey: queryKeys.sales.team() });
    },
  });
}

export function useLinkLogin() {
  const qc = useQueryClient();
  return useMutation<Person, ApiError, { sfUserId: string; userId: string }>({
    mutationFn: ({ sfUserId, userId }) => sales.linkLogin(sfUserId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sales.people() });
      qc.invalidateQueries({ queryKey: queryKeys.sales.team() });
    },
  });
}

export function useUnlinkLogin() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, { sfUserId: string }>({
    mutationFn: ({ sfUserId }) => sales.unlinkLogin(sfUserId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sales.people() });
      qc.invalidateQueries({ queryKey: queryKeys.sales.team() });
    },
  });
}

export function useRunSync() {
  const qc = useQueryClient();
  return useMutation<SyncRun, ApiError, { full?: boolean }>({
    mutationFn: ({ full }) => sales.runSync(full ?? false),
    // Every sales screen may change after a sync.
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.sales.all }),
  });
}
