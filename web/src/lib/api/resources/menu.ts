import { api } from "../client";
import type { ExtractMenuInput, MenuSummary, MerchantMenu } from "@/features/merchants/types";

/* Merchant menu — extracted from Innowi Online Ordering (routers/menu.py). */
export type { MerchantMenu, MenuSummary, MenuItem, ExtractMenuInput } from "@/features/merchants/types";

export const menu = {
  /** GET /merchants/:merchantId/menu — stored menu, empty `items` before the first extraction. */
  get(merchantId: string): Promise<MerchantMenu> {
    return api.get<MerchantMenu>(`/merchants/${merchantId}/menu`);
  },
  /** POST /merchants/:merchantId/menu/extract — starts it in the background
   *  (202, lastStatus RUNNING); poll `get` for progress and the result. */
  extract(merchantId: string, input: ExtractMenuInput): Promise<MenuSummary> {
    return api.postLong<MenuSummary>(`/merchants/${merchantId}/menu/extract`, input);
  },
  /** Same-origin CSV download link (the proxy attaches the session). */
  exportUrl(merchantId: string, scope: "valid" | "all" = "valid"): string {
    return api.fileUrl(`/merchants/${merchantId}/menu/export?scope=${scope}`);
  },
};

/** True for an Innowi online-ordering link (…innowi.com/branch/<name>) — the
 *  only kind the menu can be loaded from. Mirrors menu_extractor.is_innowi_ordering_link. */
export function isInnowiOrderingLink(value?: string | null): boolean {
  if (!value) return false;
  const v = value.trim();
  return /^(https?:\/\/)?([a-z0-9-]+\.)*innowi\.com\/branch\/[A-Za-z0-9][A-Za-z0-9_.-]*\/?([?#].*)?$/i.test(v);
}
