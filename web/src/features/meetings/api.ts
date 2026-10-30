"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { meetings } from "@/lib/api/resources/meetings";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { PagedEnvelope } from "@/types/api";
import type { FathomStatus, MeetingDetail, MeetingListQuery, MeetingSummary, UpdateMeetingInput } from "./types";

export function useMeetings(query: MeetingListQuery) {
  return useQuery<PagedEnvelope<MeetingSummary>, ApiError>({
    queryKey: queryKeys.meetings.list(query),
    queryFn: () => meetings.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useMeeting(id: string) {
  return useQuery<MeetingDetail, ApiError>({ queryKey: queryKeys.meetings.detail(id), queryFn: () => meetings.get(id) });
}

export function useFathomStatus() {
  return useQuery<FathomStatus, ApiError>({ queryKey: queryKeys.meetings.status(), queryFn: () => meetings.status() });
}

export function useInvalidateMeetings() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.meetings.all });
}

export function useSyncFathom() {
  const done = useInvalidateMeetings();
  return useMutation<{ fetched: number; added: number; updated: number }, ApiError, void>({
    mutationFn: () => meetings.sync(),
    onSettled: done,
  });
}

function useDetailMutation<V>(id: string, fn: (v: V) => Promise<MeetingDetail>) {
  const qc = useQueryClient();
  return useMutation<MeetingDetail, ApiError, V>({
    mutationFn: fn,
    onSuccess: (d) => {
      qc.setQueryData(queryKeys.meetings.detail(id), d);
      qc.invalidateQueries({ queryKey: [...queryKeys.meetings.all, "list"] });
      qc.invalidateQueries({ queryKey: queryKeys.meetings.status() });
    },
  });
}

export const useUpdateMeeting = (id: string) => useDetailMutation<UpdateMeetingInput>(id, (v) => meetings.update(id, v));
export const useDismissAction = (id: string) => useDetailMutation<string>(id, (a) => meetings.dismiss(id, a));
export const useReopenAction = (id: string) => useDetailMutation<string>(id, (a) => meetings.reopen(id, a));

export function useDeleteMeeting() {
  const done = useInvalidateMeetings();
  return useMutation<void, ApiError, string>({ mutationFn: (id) => meetings.remove(id), onSuccess: done });
}
