import type { Id, ISODateString, YesNo } from "./enums";

/**
 * Brand profile — 1:1 with the merchant (PRD §6.2.5 brand rules; the workbook's
 * nine brand columns). `GET` never 404s: before the first write the API returns
 * this shape with every value null and `exists: false`, so the form renders
 * either way. `PATCH` merge-upserts (omitted keys untouched, null clears).
 */
export interface BrandProfile {
  merchantId: Id;
  exists: boolean;
  brandColors: string | null;
  brandFonts: string | null;
  logoVector: YesNo | null;
  photoLibraryStatus: string | null;
  menuFormat: string | null;
  signatureDishes: string | null;
  toneOfVoice: string | null;
  doNotSay: string | null;
  contentRestrictions: string | null;
  updatedAt: ISODateString | null;
}

export type UpsertBrandProfileInput = {
  brandColors?: string | null;
  brandFonts?: string | null;
  logoVector?: YesNo | null;
  photoLibraryStatus?: string | null;
  menuFormat?: string | null;
  signatureDishes?: string | null;
  toneOfVoice?: string | null;
  doNotSay?: string | null;
  contentRestrictions?: string | null;
};
