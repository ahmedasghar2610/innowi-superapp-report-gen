import { api } from "../client";
import type { BrandAsset, UpdateBrandAssetInput, UploadBrandAssetInput } from "@/features/merchants/types";

/* Brand assets — §6.2.5 files held by the platform. Upload-only creation. */
export type {
  BrandAsset,
  BrandAssetType,
  BrandAssetStatus,
  UploadBrandAssetInput,
  UpdateBrandAssetInput,
} from "@/features/merchants/types";

export const brandAssets = {
  /** GET /merchants/:merchantId/brand-assets (by type, newest first). */
  list(merchantId: string): Promise<BrandAsset[]> {
    return api.getList<BrandAsset>(`/merchants/${merchantId}/brand-assets`);
  },
  /** POST /merchants/:merchantId/brand-assets/upload — multipart. */
  upload(merchantId: string, file: File, input: UploadBrandAssetInput): Promise<BrandAsset> {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("type", input.type);
    if (input.name) form.append("name", input.name);
    return api.postForm<BrandAsset>(`/merchants/${merchantId}/brand-assets/upload`, form);
  },
  /** PATCH /brand-assets/:id — type / name / status; the file itself is immutable. */
  update(id: string, input: UpdateBrandAssetInput): Promise<BrandAsset> {
    return api.patch<BrandAsset>(`/brand-assets/${id}`, input);
  },
  /** DELETE /brand-assets/:id → 204 (row and file). */
  remove(id: string): Promise<void> {
    return api.del(`/brand-assets/${id}`);
  },
};
