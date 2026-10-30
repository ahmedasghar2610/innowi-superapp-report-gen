import { api } from "../client";
import type { Competitor, CreateCompetitorInput, UpdateCompetitorInput } from "@/features/merchants/types";

/* Competitors — flat item routes; list/create nested under the merchant. */
export type { Competitor, CreateCompetitorInput, UpdateCompetitorInput } from "@/features/merchants/types";

export const competitors = {
  /** GET /merchants/:merchantId/competitors (ranked first, then insertion order). */
  list(merchantId: string): Promise<Competitor[]> {
    return api.getList<Competitor>(`/merchants/${merchantId}/competitors`);
  },
  /** POST /merchants/:merchantId/competitors */
  create(merchantId: string, input: CreateCompetitorInput): Promise<Competitor> {
    return api.post<Competitor>(`/merchants/${merchantId}/competitors`, input);
  },
  /** PATCH /competitors/:id */
  update(id: string, input: UpdateCompetitorInput): Promise<Competitor> {
    return api.patch<Competitor>(`/competitors/${id}`, input);
  },
  /** DELETE /competitors/:id → 204 */
  remove(id: string): Promise<void> {
    return api.del(`/competitors/${id}`);
  },
};
