import type { ISODateString, MerchantSubscriptionStatus } from "./enums";

/**
 * PATCH /merchants/:merchantId/subscription — merge-upsert. On the FIRST write
 * `packageCode` and `status` are required (the API returns 400 otherwise);
 * afterwards every key is optional and `null` clears the nullable ones.
 * The response is the same `MerchantSubscription` shape embedded on Merchant.
 */
export type UpsertSubscriptionInput = {
  packageCode?: string;
  status?: MerchantSubscriptionStatus;
  startDate?: ISODateString | null;
  renewalDate?: ISODateString | null;
  mrr?: number | null;
};
