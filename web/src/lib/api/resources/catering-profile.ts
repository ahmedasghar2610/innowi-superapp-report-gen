import { api } from "../client";
import type { CateringProfile, UpsertCateringProfileInput } from "@/features/merchants/types";

/* Catering profile — 1:1 with the merchant; same contract as brand profile. */
export type { CateringProfile, UpsertCateringProfileInput } from "@/features/merchants/types";

export const cateringProfile = {
  /** GET /merchants/:merchantId/catering-profile */
  get(merchantId: string): Promise<CateringProfile> {
    return api.get<CateringProfile>(`/merchants/${merchantId}/catering-profile`);
  },
  /** PATCH /merchants/:merchantId/catering-profile — merge-upsert. */
  upsert(merchantId: string, input: UpsertCateringProfileInput): Promise<CateringProfile> {
    return api.patch<CateringProfile>(`/merchants/${merchantId}/catering-profile`, input);
  },
};
