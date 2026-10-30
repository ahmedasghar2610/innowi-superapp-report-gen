import type { Id, ISODateString, YesNo } from "./enums";

/** Catering profile — 1:1 with the merchant; same GET-empty / PATCH-upsert contract as BrandProfile. */
export interface CateringProfile {
  merchantId: Id;
  exists: boolean;
  offered: YesNo | null;
  contact: string | null;
  leadFlow: string | null;
  minOrder: string | null;
  notes: string | null;
  updatedAt: ISODateString | null;
}

export type UpsertCateringProfileInput = {
  offered?: YesNo | null;
  contact?: string | null;
  leadFlow?: string | null;
  minOrder?: string | null;
  notes?: string | null;
};
