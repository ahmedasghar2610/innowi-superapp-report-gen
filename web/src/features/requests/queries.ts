"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requests } from "@/lib/api/resources/requests";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type {
  ApproveInput,
  RequestDetail,
  RequestInput,
  RequestList,
  RequestQuery,
  StatusChangeInput,
} from "./types";

export function useRequestList(query: RequestQuery) {
  return useQuery<RequestList, ApiError>({
    queryKey: queryKeys.requests.list(query),
    queryFn: () => requests.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useRequest(ref?: string) {
  return useQuery<RequestDetail, ApiError>({
    queryKey: queryKeys.requests.detail(ref ?? ""),
    queryFn: () => requests.get(ref!),
    enabled: !!ref,
  });
}

/** Every mutation answers with the fresh request: store it, refresh the lists. */
function useSaved() {
  const qc = useQueryClient();
  return (d: RequestDetail) => {
    qc.setQueryData(queryKeys.requests.detail(d.ref), d);
    qc.invalidateQueries({ queryKey: queryKeys.requests.lists() });
  };
}

export function useCreateRequest() {
  const saved = useSaved();
  return useMutation<RequestDetail, ApiError, RequestInput>({ mutationFn: requests.create, onSuccess: saved });
}

export function useUpdateRequest() {
  const saved = useSaved();
  return useMutation<RequestDetail, ApiError, { ref: string; input: Partial<RequestInput> }>({
    mutationFn: ({ ref, input }) => requests.update(ref, input),
    onSuccess: saved,
  });
}

export function useVote() {
  const qc = useQueryClient();
  const saved = useSaved();
  return useMutation<RequestDetail, ApiError, { ref: string; on: boolean }, { snaps: [readonly unknown[], RequestList | undefined][] }>({
    mutationFn: ({ ref, on }) => (on ? requests.vote(ref) : requests.unvote(ref)),
    // The count moves right away in every list; the server answer replaces the guess.
    onMutate: async ({ ref, on }) => {
      await qc.cancelQueries({ queryKey: queryKeys.requests.lists() });
      const snaps = qc.getQueriesData<RequestList>({ queryKey: queryKeys.requests.lists() });
      for (const [key, list] of snaps) {
        if (!list) continue;
        qc.setQueryData<RequestList>(key, {
          ...list,
          data: list.data.map((r) =>
            r.ref === ref && r.votedByMe !== on ? { ...r, votedByMe: on, votes: r.votes + (on ? 1 : -1) } : r,
          ),
        });
      }
      return { snaps };
    },
    onError: (_e, _v, ctx) => ctx?.snaps.forEach(([key, list]) => list && qc.setQueryData<RequestList>(key, list)),
    onSuccess: saved,
  });
}

export function useComment() {
  const saved = useSaved();
  return useMutation<RequestDetail, ApiError, { ref: string; body: string }>({
    mutationFn: ({ ref, body }) => requests.comment(ref, body),
    onSuccess: saved,
  });
}

export function useSetStatus() {
  const saved = useSaved();
  return useMutation<RequestDetail, ApiError, { ref: string; input: StatusChangeInput }>({
    mutationFn: ({ ref, input }) => requests.setStatus(ref, input),
    onSuccess: saved,
  });
}

export function useApprove() {
  const qc = useQueryClient();
  const saved = useSaved();
  return useMutation<RequestDetail, ApiError, { ref: string; input: ApproveInput }>({
    mutationFn: ({ ref, input }) => requests.approve(ref, input),
    onSuccess: (d) => {
      saved(d);
      qc.invalidateQueries({ queryKey: queryKeys.roadmap.all });
    },
  });
}
