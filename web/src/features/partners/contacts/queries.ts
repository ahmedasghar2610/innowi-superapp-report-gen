"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { partnerContacts } from "@/lib/api/resources/partner-contacts";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError, PagedEnvelope } from "@/lib/api/client";
import type { QueryOpts } from "@/lib/query/hook-types";
import type {
  CreatePartnerContactInput,
  PartnerContact,
  PartnerContactQuery,
  PartnerContactSummary,
  PromotedContact,
  UpdatePartnerContactInput,
} from "./types";

export function usePartnerContacts(query?: PartnerContactQuery, options?: QueryOpts<PagedEnvelope<PartnerContact>>) {
  return useQuery<PagedEnvelope<PartnerContact>, ApiError>({
    queryKey: queryKeys.partnerContacts.list(query ?? {}),
    queryFn: () => partnerContacts.list(query),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function usePartnerContactSummary(options?: QueryOpts<PartnerContactSummary>) {
  return useQuery<PartnerContactSummary, ApiError>({
    queryKey: queryKeys.partnerContacts.summary(),
    queryFn: () => partnerContacts.summary(),
    ...options,
  });
}

export function usePartnerContact(id: string | undefined, options?: QueryOpts<PartnerContact>) {
  return useQuery<PartnerContact, ApiError>({
    queryKey: queryKeys.partnerContacts.detail(id ?? ""),
    queryFn: () => partnerContacts.get(id as string),
    enabled: !!id,
    ...options,
  });
}

function useInvalidateContacts() {
  const qc = useQueryClient();
  return (id?: string) => {
    if (id) void qc.invalidateQueries({ queryKey: queryKeys.partnerContacts.detail(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.partnerContacts.lists() });
    void qc.invalidateQueries({ queryKey: queryKeys.partnerContacts.summary() });
  };
}

export function useUpdatePartnerContact() {
  const invalidate = useInvalidateContacts();
  return useMutation<PartnerContact, ApiError, { id: string; input: UpdatePartnerContactInput }>({
    mutationFn: ({ id, input }) => partnerContacts.update(id, input),
    onSuccess: (_c, { id }) => invalidate(id),
  });
}

export function useCreatePartnerContact() {
  const invalidate = useInvalidateContacts();
  return useMutation<PartnerContact, ApiError, CreatePartnerContactInput>({
    mutationFn: (input) => partnerContacts.create(input),
    onSuccess: () => invalidate(),
  });
}

/** Promotion also creates a partner lead, so the leads screens refresh too. */
export function usePromotePartnerContact() {
  const qc = useQueryClient();
  const invalidate = useInvalidateContacts();
  return useMutation<PromotedContact, ApiError, { id: string; partnerType?: string | null }>({
    mutationFn: ({ id, partnerType }) => partnerContacts.promote(id, partnerType),
    onSuccess: (_r, { id }) => {
      invalidate(id);
      void qc.invalidateQueries({ queryKey: queryKeys.partnerLeads.all });
    },
  });
}
