import { api } from "../client";
import type { Keyword, CreateKeywordInput, UpdateKeywordInput } from "@/features/merchants/types";

/* Keywords — flat item routes; list/create nested under the merchant. */
export type { Keyword, KeywordType, CreateKeywordInput, UpdateKeywordInput } from "@/features/merchants/types";

export const keywords = {
  /** GET /merchants/:merchantId/keywords (PRIMARY → SECONDARY → LOCATION, then insertion order). */
  list(merchantId: string): Promise<Keyword[]> {
    return api.getList<Keyword>(`/merchants/${merchantId}/keywords`);
  },
  /** POST /merchants/:merchantId/keywords — 409 on a duplicate (term, type). */
  create(merchantId: string, input: CreateKeywordInput): Promise<Keyword> {
    return api.post<Keyword>(`/merchants/${merchantId}/keywords`, input);
  },
  /** PATCH /keywords/:id */
  update(id: string, input: UpdateKeywordInput): Promise<Keyword> {
    return api.patch<Keyword>(`/keywords/${id}`, input);
  },
  /** DELETE /keywords/:id → 204 */
  remove(id: string): Promise<void> {
    return api.del(`/keywords/${id}`);
  },
};
