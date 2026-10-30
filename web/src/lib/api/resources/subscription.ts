import { api } from "../client";
import type { MerchantSubscription, UpsertSubscriptionInput } from "@/features/merchants/types";

/* Subscription — 1:1 with the merchant. The merchant response already embeds
   it, so most screens never call `get`; `upsert` is the write path. */
export type { MerchantSubscription, UpsertSubscriptionInput } from "@/features/merchants/types";

export const subscription = {
  /** GET /merchants/:merchantId/subscription — 404 when none exists yet. */
  get(merchantId: string): Promise<MerchantSubscription> {
    return api.get<MerchantSubscription>(`/merchants/${merchantId}/subscription`);
  },
  /** PATCH /merchants/:merchantId/subscription — merge-upsert (Manager/Admin). */
  upsert(merchantId: string, input: UpsertSubscriptionInput): Promise<MerchantSubscription> {
    return api.patch<MerchantSubscription>(`/merchants/${merchantId}/subscription`, input);
  },
};
