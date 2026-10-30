import { api } from "../client";
import type { ItemInput, Phase, PhaseInput, Roadmap, RoadmapItem } from "@/features/roadmap/types";

/** /roadmap — phases, items and owners (API: app/modules/roadmap/router.py). */
export const roadmap = {
  get: () => api.get<Roadmap>("/roadmap"),
  createPhase: (input: PhaseInput) => api.post<Phase>("/roadmap/phases", input),
  updatePhase: (id: string, input: Partial<PhaseInput>) => api.patch<Phase>(`/roadmap/phases/${id}`, input),
  deletePhase: (id: string) => api.del(`/roadmap/phases/${id}`),
  createItem: (input: ItemInput & { phaseId: string; title: string; area: string }) =>
    api.post<RoadmapItem>("/roadmap/items", input),
  updateItem: (id: string, input: ItemInput) => api.patch<RoadmapItem>(`/roadmap/items/${id}`, input),
  deleteItem: (id: string) => api.del(`/roadmap/items/${id}`),
};
