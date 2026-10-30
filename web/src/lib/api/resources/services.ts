import { api } from "../client";
import type {
  MerchantService,
  CreateMerchantServiceInput,
  UpdateMerchantServiceInput,
} from "@/features/merchants/types";

/* Merchant ↔ catalogue service links. §7.
   The catalogue itself (packages, services, entitlements) is a separate,
   standalone Catalog API — see @/lib/api/resources/catalog and
   @/features/catalog. */
export type {
  MerchantService,
  MerchantServiceStatus,
  ServiceCategory,
  CreateMerchantServiceInput,
  UpdateMerchantServiceInput,
} from "@/features/merchants/types";

export const services = {
  /** GET /merchants/:merchantId/services (not paginated). */
  list(merchantId: string): Promise<MerchantService[]> {
    return api.getList<MerchantService>(`/merchants/${merchantId}/services`);
  },

  /** POST /merchants/:merchantId/services — 409 if already active. */
  create(merchantId: string, input: CreateMerchantServiceInput): Promise<MerchantService> {
    return api.post<MerchantService>(`/merchants/${merchantId}/services`, input);
  },

  /** PATCH /services/:id — status / activatedAt / notes only. */
  update(id: string, input: UpdateMerchantServiceInput): Promise<MerchantService> {
    return api.patch<MerchantService>(`/services/${id}`, input);
  },

  /** DELETE /services/:id → 204. Prefer PATCH {status:"INACTIVE"} to keep history. */
  remove(id: string): Promise<void> {
    return api.del(`/services/${id}`);
  },
};
