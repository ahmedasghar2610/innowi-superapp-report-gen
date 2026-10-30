import { api } from "../client";
import type { Promotion, CreatePromotionInput, UpdatePromotionInput } from "@/features/merchants/types";

/* Promotions / Offers — Profiling's master list (PRD Appendix C-7 / PROF-01
   §6.2.4). GBP, Google Ads and Email/SMS reference these read-only and track
   their own channel-specific state; that linkage isn't modeled here. */
export type { Promotion, PromotionStatus, CreatePromotionInput, UpdatePromotionInput } from "@/features/merchants/types";

export const promotions = {
  /** GET /merchants/:merchantId/promotions (newest first). */
  list(merchantId: string): Promise<Promotion[]> {
    return api.getList<Promotion>(`/merchants/${merchantId}/promotions`);
  },

  /** POST /merchants/:merchantId/promotions. */
  create(merchantId: string, input: CreatePromotionInput): Promise<Promotion> {
    return api.post<Promotion>(`/merchants/${merchantId}/promotions`, input);
  },

  /** PATCH /promotions/:id. */
  update(id: string, input: UpdatePromotionInput): Promise<Promotion> {
    return api.patch<Promotion>(`/promotions/${id}`, input);
  },

  /** DELETE /promotions/:id → 204. */
  remove(id: string): Promise<void> {
    return api.del(`/promotions/${id}`);
  },
};
