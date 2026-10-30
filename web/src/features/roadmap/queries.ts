"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roadmap } from "@/lib/api/resources/roadmap";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { ItemInput, Phase, PhaseInput, Roadmap, RoadmapItem } from "./types";

export function useRoadmap() {
  return useQuery<Roadmap, ApiError>({ queryKey: queryKeys.roadmap.all, queryFn: roadmap.get });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.roadmap.all });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation<RoadmapItem, ApiError, { id: string; input: ItemInput }, { prev?: Roadmap }>({
    mutationFn: ({ id, input }) => roadmap.updateItem(id, input),
    // Status changes from the list feel instant; the server answer replaces the guess.
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: queryKeys.roadmap.all });
      const prev = qc.getQueryData<Roadmap>(queryKeys.roadmap.all);
      if (prev && input.status && Object.keys(input).length === 1) {
        qc.setQueryData<Roadmap>(queryKeys.roadmap.all, {
          ...prev,
          phases: prev.phases.map((p) => ({
            ...p,
            items: p.items.map((i) => (i.id === id ? { ...i, status: input.status! } : i)),
          })),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.roadmap.all, ctx.prev);
    },
    onSettled: invalidate,
  });
}

export function useCreateItem() {
  const invalidate = useInvalidate();
  return useMutation<RoadmapItem, ApiError, ItemInput & { phaseId: string; title: string; area: string }>({
    mutationFn: roadmap.createItem,
    onSuccess: invalidate,
  });
}

export function useDeleteItem() {
  const invalidate = useInvalidate();
  return useMutation<void, ApiError, string>({ mutationFn: roadmap.deleteItem, onSuccess: invalidate });
}

export function useSavePhase() {
  const invalidate = useInvalidate();
  return useMutation<Phase, ApiError, { id?: string; input: PhaseInput }>({
    mutationFn: ({ id, input }) => (id ? roadmap.updatePhase(id, input) : roadmap.createPhase(input)),
    onSuccess: invalidate,
  });
}

export function useDeletePhase() {
  const invalidate = useInvalidate();
  return useMutation<void, ApiError, string>({ mutationFn: roadmap.deletePhase, onSuccess: invalidate });
}
