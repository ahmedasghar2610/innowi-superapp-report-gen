import type { Id, ISODateString } from "./enums";

/** §6.2.5 asset classes (mirrors the API's BRAND_ASSET_TYPES). */
export const BRAND_ASSET_TYPE = ["LOGO", "MENU", "IMAGE", "VIDEO", "BRAND_GUIDELINES", "OTHER"] as const;
export type BrandAssetType = (typeof BRAND_ASSET_TYPE)[number];

export const BRAND_ASSET_STATUS = ["ACTIVE", "ARCHIVED"] as const;
export type BrandAssetStatus = (typeof BRAND_ASSET_STATUS)[number];

/**
 * A file the platform holds for the merchant's brand (logo, menu, images…).
 * Always uploaded — there is no metadata-only create. ACTIVE assets satisfy
 * the completeness "files" slots; ARCHIVED ones don't.
 */
export interface BrandAsset {
  id: Id;
  merchantId: Id;
  type: BrandAssetType;
  name: string | null;
  status: BrandAssetStatus;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: string | null;
  hasFile: boolean;
  downloadPath: string | null;
  createdAt: ISODateString;
}

/** Form fields for the multipart upload (file goes in the `file` part). */
export interface UploadBrandAssetInput {
  type: BrandAssetType;
  name?: string;
}

export type UpdateBrandAssetInput = {
  type?: BrandAssetType;
  name?: string | null;
  status?: BrandAssetStatus;
};
