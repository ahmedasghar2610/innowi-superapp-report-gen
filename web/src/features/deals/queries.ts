"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deals, organizations } from "@/lib/api/resources/deals";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError, PagedEnvelope } from "@/lib/api/client";
import type { QueryOpts } from "@/lib/query/hook-types";
import type {
  AddAgentsResult,
  AgentInput,
  AssignInput,
  AssignResult,
  OrganizationLinks,
  CreateDealInput,
  CreateOrganizationInput,
  DealBoard,
  DealDetail,
  DealQuery,
  DealRow,
  Organization,
  OrganizationContact,
  OrganizationContactInput,
  OrganizationDetail,
  OrganizationQuery,
  UpdateDealInput,
  UpdateOrganizationInput,
} from "./types";

// ─── deals ────────────────────────────────────────────────────────────────
export function useDealList(query?: DealQuery, options?: QueryOpts<PagedEnvelope<DealRow>>) {
  return useQuery<PagedEnvelope<DealRow>, ApiError>({
    queryKey: queryKeys.deals.list(query ?? {}),
    queryFn: () => deals.list(query),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useDealBoard(query?: DealQuery, options?: QueryOpts<DealBoard>) {
  return useQuery<DealBoard, ApiError>({
    queryKey: queryKeys.deals.board(query ?? {}),
    queryFn: () => deals.board(query),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useDealDetail(id?: string | null, options?: QueryOpts<DealDetail>) {
  return useQuery<DealDetail, ApiError>({
    queryKey: queryKeys.deals.detail(id ?? ""),
    queryFn: () => deals.get(id!),
    enabled: !!id,
    ...options,
  });
}

function useInvalidateDeals() {
  const qc = useQueryClient();
  return (detail?: DealDetail) => {
    qc.invalidateQueries({ queryKey: queryKeys.deals.all });
    // A stage change may have moved the merchant's status, and organizations show deal counts.
    qc.invalidateQueries({ queryKey: queryKeys.merchants.all });
    qc.invalidateQueries({ queryKey: queryKeys.organizations.all });
    if (detail) qc.setQueryData(queryKeys.deals.detail(detail.id), detail);
  };
}

export function useCreateDeal() {
  const invalidate = useInvalidateDeals();
  return useMutation<DealDetail, ApiError, CreateDealInput>({ mutationFn: deals.create, onSuccess: (d) => invalidate(d) });
}

export function useUpdateDeal() {
  const invalidate = useInvalidateDeals();
  return useMutation<DealDetail, ApiError, { id: string; input: UpdateDealInput }>({
    mutationFn: ({ id, input }) => deals.update(id, input),
    onSuccess: (d) => invalidate(d),
  });
}

export function useAddDealNote() {
  const invalidate = useInvalidateDeals();
  return useMutation<DealDetail, ApiError, { id: string; body: string }>({
    mutationFn: ({ id, body }) => deals.addNote(id, body),
    onSuccess: (d) => invalidate(d),
  });
}

export function useLinkQuoteToDeal() {
  const qc = useQueryClient();
  const invalidate = useInvalidateDeals();
  return useMutation<DealDetail, ApiError, { id: string; linkId: string }>({
    mutationFn: ({ id, linkId }) => deals.linkQuote(id, linkId),
    onSuccess: (d) => {
      invalidate(d);
      qc.invalidateQueries({ queryKey: queryKeys.quotes.all });
    },
  });
}

// ─── organizations ────────────────────────────────────────────────────────
export function useOrganizationList(query?: OrganizationQuery, options?: QueryOpts<PagedEnvelope<Organization>>) {
  return useQuery<PagedEnvelope<Organization>, ApiError>({
    queryKey: queryKeys.organizations.list(query ?? {}),
    queryFn: () => organizations.list(query),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useOrganizationDetail(id?: string | null, options?: QueryOpts<OrganizationDetail>) {
  return useQuery<OrganizationDetail, ApiError>({
    queryKey: queryKeys.organizations.detail(id ?? ""),
    queryFn: () => organizations.get(id!),
    enabled: !!id,
    ...options,
  });
}

function useInvalidateOrganizations() {
  const qc = useQueryClient();
  return (detail?: OrganizationDetail, id?: string) => {
    qc.invalidateQueries({ queryKey: queryKeys.organizations.all });
    qc.invalidateQueries({ queryKey: queryKeys.deals.all });
    if (detail) qc.setQueryData(queryKeys.organizations.detail(detail.id), detail);
    else if (id) qc.invalidateQueries({ queryKey: queryKeys.organizations.detail(id) });
  };
}

export function useCreateOrganization() {
  const invalidate = useInvalidateOrganizations();
  return useMutation<OrganizationDetail, ApiError, CreateOrganizationInput>({
    mutationFn: organizations.create,
    onSuccess: (o) => invalidate(o),
  });
}

export function useUpdateOrganization() {
  const invalidate = useInvalidateOrganizations();
  return useMutation<OrganizationDetail, ApiError, { id: string; input: UpdateOrganizationInput }>({
    mutationFn: ({ id, input }) => organizations.update(id, input),
    onSuccess: (o) => invalidate(o),
  });
}

export function useSaveOrganizationContact() {
  const invalidate = useInvalidateOrganizations();
  return useMutation<OrganizationContact, ApiError, { id: string; contactId?: string; input: OrganizationContactInput }>({
    mutationFn: ({ id, contactId, input }) =>
      contactId ? organizations.updateContact(id, contactId, input) : organizations.addContact(id, input),
    onSuccess: (_c, vars) => invalidate(undefined, vars.id),
  });
}

export function useRemoveOrganizationContact() {
  const invalidate = useInvalidateOrganizations();
  return useMutation<void, ApiError, { id: string; contactId: string }>({
    mutationFn: ({ id, contactId }) => organizations.removeContact(id, contactId),
    onSuccess: (_v, vars) => invalidate(undefined, vars.id),
  });
}

export function useAddOrganizationNote() {
  const invalidate = useInvalidateOrganizations();
  return useMutation<OrganizationDetail, ApiError, { id: string; body: string }>({
    mutationFn: ({ id, body }) => organizations.addNote(id, body),
    onSuccess: (o) => invalidate(o),
  });
}

export function useAddAgents() {
  const invalidate = useInvalidateOrganizations();
  return useMutation<AddAgentsResult, ApiError, { id: string; agents: AgentInput[]; dryRun?: boolean }>({
    mutationFn: ({ id, agents, dryRun }) => organizations.addAgents(id, agents, dryRun),
    onSuccess: (r, vars) => {
      if (!r.dryRun) invalidate(undefined, vars.id);
    },
  });
}

/** Bulk hand-out. Call with dryRun true for the preview, false to apply. */
export function useAssignOrganizations() {
  const invalidate = useInvalidateOrganizations();
  return useMutation<AssignResult, ApiError, AssignInput>({
    mutationFn: organizations.assign,
    onSuccess: (r, vars) => {
      if (!r.dryRun) invalidate(undefined, vars.parentId);
    },
  });
}

export function useOrganizationFromLead() {
  const qc = useQueryClient();
  const invalidate = useInvalidateOrganizations();
  return useMutation<OrganizationDetail, ApiError, { leadId: string; organizationId?: string }>({
    mutationFn: ({ leadId, organizationId }) => organizations.fromLead(leadId, organizationId),
    onSuccess: (o) => {
      invalidate(o);
      qc.invalidateQueries({ queryKey: ["organization-links"] });
    },
  });
}

export function useOrganizationFromCard() {
  const qc = useQueryClient();
  const invalidate = useInvalidateOrganizations();
  return useMutation<OrganizationDetail, ApiError, { contactId: string; organizationId?: string }>({
    mutationFn: ({ contactId, organizationId }) => organizations.fromCard(contactId, organizationId),
    onSuccess: (o) => {
      invalidate(o);
      qc.invalidateQueries({ queryKey: ["organization-links"] });
    },
  });
}

/** Which organization each partner lead / business card belongs to. */
export function useOrganizationLinks(leadIds: string[], contactIds: string[], options?: QueryOpts<OrganizationLinks>) {
  return useQuery<OrganizationLinks, ApiError>({
    queryKey: ["organization-links", leadIds.join(","), contactIds.join(",")],
    queryFn: () => organizations.links(leadIds, contactIds),
    enabled: leadIds.length + contactIds.length > 0,
    staleTime: 30_000,
    ...options,
  });
}
