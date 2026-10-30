import { api } from "../client";
import type { DataQualityResponse } from "@/features/merchants/types";

/* Portfolio data quality (M1-02). One call, whole portfolio. */
export type { DataQualityResponse, DataQualityMerchant, CompletenessBand } from "@/features/merchants/types";

export const dataQuality = {
  /** GET /profiling/data-quality */
  get(): Promise<DataQualityResponse> {
    return api.get<DataQualityResponse>("/profiling/data-quality");
  },
};
