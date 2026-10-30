import { api } from "../client";
import type { PagedEnvelope } from "@/types/api";
import type {
  ImportDecisions,
  ImportReport,
  MenuFetchResult,
  MenuStatusRow,
  Merchant,
  CreateMerchantInput,
  UpdateMerchantInput,
  MerchantListQuery,
} from "@/features/merchants/types";

/* Merchants — identity record + the only paginated list. API_REFERENCE.md §3.
   Types are the single source of truth in @/features/merchants/types; re-exported
   here for convenience. */
export type { Merchant, AccountHealth, CreateMerchantInput, UpdateMerchantInput, MerchantListQuery } from "@/features/merchants/types";

export const merchants = {
  /** GET /merchants → paginated `{ data, meta }`. */
  list(query?: MerchantListQuery): Promise<PagedEnvelope<Merchant>> {
    return api.getPage<Merchant>("/merchants", query);
  },

  /** GET /merchants/:id → bare merchant (404 if missing). */
  get(id: string): Promise<Merchant> {
    return api.get<Merchant>(`/merchants/${id}`);
  },

  /** POST /merchants → created merchant (409 on duplicate name). */
  create(input: CreateMerchantInput): Promise<Merchant> {
    return api.post<Merchant>("/merchants", input);
  },

  /** PATCH /merchants/:id → full updated merchant (bulk form save). */
  update(id: string, input: UpdateMerchantInput): Promise<Merchant> {
    return api.patch<Merchant>(`/merchants/${id}`, input);
  },

  /** DELETE /merchants/:id → 204. Hard delete; cascades all children. */
  remove(id: string): Promise<void> {
    return api.del(`/merchants/${id}`);
  },

  /** POST /merchants/import — the Merchants sheet (.xlsx / .csv). dryRun = preview, nothing written. */
  importFile(file: File, dryRun: boolean, decisions?: ImportDecisions): Promise<ImportReport> {
    const form = new FormData();
    form.append("file", file);
    if (decisions) form.append("decisions", JSON.stringify(decisions));
    return api.postForm<ImportReport>(`/merchants/import?dryRun=${dryRun ? "true" : "false"}`, form);
  },
};

/** Menus across merchants (API routers/menu_bulk.py). */
export const merchantMenus = {
  status(ids?: string[]): Promise<{ data: MenuStatusRow[]; counts: Record<string, number> }> {
    return api.get("/merchant-menus", ids ? { ids: ids.join(",") } : undefined);
  },
  check(merchantIds: string[]): Promise<{ data: MenuStatusRow[] }> {
    return api.post("/merchant-menus/check", { merchantIds });
  },
  fetch(merchantIds: string[]): Promise<MenuFetchResult> {
    return api.postLong("/merchant-menus/fetch", { merchantIds });
  },
  pickLink(merchantId: string, link: string): Promise<MenuStatusRow> {
    return api.put(`/merchant-menus/${merchantId}/link`, { link });
  },
};
