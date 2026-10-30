import type { Id, ISODateString, PromotionStatus, YesNo } from "./enums";

/**
 * Promotion / offer — the master list of a merchant's promotions
 * (PRD Appendix C-7 / PROF-01 §6.2.4). Profiling owns this list; GBP, Google
 * Ads and Email/SMS are expected to reference a profile promotion where one
 * exists and track their own channel-specific status separately (not
 * implemented in those modules yet). Maps to the workbook "Promotions" tab.
 */
export interface Promotion {
  id: Id;
  merchantId: Id;
  promoName: string | null;
  offerType: string | null;
  offerValue: string | null;
  promoCode: string | null;
  channels: string | null;
  startDate: ISODateString | null;
  endDate: ISODateString | null;
  status: PromotionStatus;
  redemptions: string | null;
  redemptionMethod: string | null;
  approvalOwner: string | null;
  staffBriefed: YesNo | null;
  blackoutDates: string | null;
  notes: string | null;
  createdAt: ISODateString;
}

/** CreatePromotionDto — every field is optional (no field is required by the API). */
export interface CreatePromotionInput {
  promoName?: string;
  offerType?: string;
  offerValue?: string;
  promoCode?: string;
  channels?: string;
  startDate?: ISODateString;
  endDate?: ISODateString;
  status?: PromotionStatus;
  redemptions?: string;
  redemptionMethod?: string;
  approvalOwner?: string;
  staffBriefed?: YesNo;
  blackoutDates?: string;
  notes?: string;
}

/**
 * UpdatePromotionDto = Partial<Create> (API). Optional fields may also be
 * sent as `null` to clear them; `status` is never null.
 */
export type UpdatePromotionInput = {
  status?: PromotionStatus;
} & {
  [K in Exclude<keyof CreatePromotionInput, "status">]?: CreatePromotionInput[K] | null;
};
