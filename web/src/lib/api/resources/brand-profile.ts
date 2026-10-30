import { api } from "../client";
import type { BrandProfile, UpsertBrandProfileInput } from "@/features/merchants/types";

/* Brand profile — 1:1 with the merchant. No id, no list, no delete. */
export type { BrandProfile, UpsertBrandProfileInput } from "@/features/merchants/types";

export const brandProfile = {
  /** GET /merchants/:merchantId/brand-profile — never 404s for a missing row (`exists: false`). */
  get(merchantId: string): Promise<BrandProfile> {
    return api.get<BrandProfile>(`/merchants/${merchantId}/brand-profile`);
  },
  /** PATCH /merchants/:merchantId/brand-profile — merge-upsert; creates the row on first write. */
  upsert(merchantId: string, input: UpsertBrandProfileInput): Promise<BrandProfile> {
    return api.patch<BrandProfile>(`/merchants/${merchantId}/brand-profile`, input);
  },
};
