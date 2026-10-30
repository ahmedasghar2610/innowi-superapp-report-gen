"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { partnerLeads } from "@/lib/api/resources/partner-leads";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError, PagedEnvelope } from "@/lib/api/client";
import type { QueryOpts } from "@/lib/query/hook-types";
import type {
  PartnerLead,
  PartnerLeadDetail,
  PartnerLeadNote,
  PartnerLeadQuery,
  PartnerLeadSummary,
  PartnerTeamMember,
  UpdatePartnerLeadInput,
  UpdatePartnerTeamMemberInput,
} from "./types";

export function usePartnerLeads(query?: PartnerLeadQuery, options?: QueryOpts<PagedEnvelope<PartnerLead>>) {
  return useQuery<PagedEnvelope<PartnerLead>, ApiError>({
    queryKey: queryKeys.partnerLeads.list(query ?? {}),
    queryFn: () => partnerLeads.list(query),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function usePartnerLeadSummary(options?: QueryOpts<PartnerLeadSummary>) {
  return useQuery<PartnerLeadSummary, ApiError>({
    queryKey: queryKeys.partnerLeads.summary(),
    queryFn: () => partnerLeads.summary(),
    ...options,
  });
}

export function usePartnerTeam(options?: QueryOpts<PartnerTeamMember[]>) {
  return useQuery<PartnerTeamMember[], ApiError>({
    queryKey: queryKeys.partnerLeads.team(),
    queryFn: () => partnerLeads.team(),
    staleTime: 5 * 60_000,
    ...options,
  });
}

/** One person's partner-lead switches (Team members screen; admins only). */
export function useUpdatePartnerTeamMember() {
  const qc = useQueryClient();
  type Vars = { email: string; input: UpdatePartnerTeamMemberInput };
  return useMutation<PartnerTeamMember, ApiError, Vars, { before?: PartnerTeamMember[] }>({
    mutationFn: ({ email, input }) => partnerLeads.updateTeamMember(email, input),
    // Flip the switch straight away; put it back if the save fails.
    // Synchronous on purpose: an awaited step here lets the controlled checkbox snap back for a moment.
    onMutate: ({ email, input }) => {
      const key = queryKeys.partnerLeads.team();
      void qc.cancelQueries({ queryKey: key }, { revert: false });
      const before = qc.getQueryData<PartnerTeamMember[]>(key);
      qc.setQueryData<PartnerTeamMember[]>(key, (list) =>
        list?.map((m) =>
          m.email === email
            ? {
                ...m,
                ...(input.assignable !== undefined && input.assignable !== null ? { assignable: input.assignable } : {}),
                ...(input.receivesNewLeads !== undefined ? { receivesNewLeads: input.receivesNewLeads } : {}),
              }
            : m,
        ),
      );
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(queryKeys.partnerLeads.team(), ctx.before);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: queryKeys.partnerLeads.team() }),
  });
}

export function usePartnerLead(id: string | undefined, options?: QueryOpts<PartnerLeadDetail>) {
  return useQuery<PartnerLeadDetail, ApiError>({
    queryKey: queryKeys.partnerLeads.detail(id ?? ""),
    queryFn: () => partnerLeads.get(id as string),
    enabled: !!id,
    ...options,
  });
}

/** Status / owner change. Refreshes the lead, the list and the summary tiles. */
export function useUpdatePartnerLead() {
  const qc = useQueryClient();
  return useMutation<PartnerLead, ApiError, { id: string; input: UpdatePartnerLeadInput }>({
    mutationFn: ({ id, input }) => partnerLeads.update(id, input),
    onSuccess: (_lead, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.partnerLeads.detail(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.partnerLeads.lists() });
      void qc.invalidateQueries({ queryKey: queryKeys.partnerLeads.summary() });
    },
  });
}

export function useAddPartnerLeadNote() {
  const qc = useQueryClient();
  return useMutation<PartnerLeadNote, ApiError, { id: string; body: string }>({
    mutationFn: ({ id, body }) => partnerLeads.addNote(id, body),
    onSuccess: (_note, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.partnerLeads.detail(id) });
    },
  });
}
