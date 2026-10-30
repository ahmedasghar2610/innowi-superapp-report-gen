import type { Id, ISODateString, MerchantServiceStatus, ServiceCategory } from "./enums";

/**
 * Merchant↔catalogue service activation (the "link row"). Maps to the workbook
 * "Entitlements"/"Delivery" tabs. The API joins the catalogue, so `serviceName`
 * and `serviceCategory` come back denormalised. API_REFERENCE.md §7.
 *
 * `serviceId` is the catalogue `Service.id` — list catalogue services via
 * `useCatalogServices()` (@/features/catalog/queries), backed by the
 * standalone Catalog API's `GET /services`.
 */
export interface MerchantService {
  id: Id; // link-row id — use for PATCH / DELETE
  merchantId: Id;
  serviceId: Id; // catalogue Service.id
  serviceName: string;
  serviceCategory: ServiceCategory;
  status: MerchantServiceStatus;
  activatedAt: ISODateString | null;
  notes: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** CreateMerchantServiceDto — `serviceId` required, must exist in the catalogue. */
export interface CreateMerchantServiceInput {
  serviceId: Id;
  status?: MerchantServiceStatus; // default ACTIVE
  activatedAt?: ISODateString;
  notes?: string;
}

/**
 * UpdateMerchantServiceDto — deliberately NOT Partial<Create>: `serviceId`
 * is not updatable (sending it is a 400). Deactivate the old link and activate
 * a new one instead of repointing.
 */
export interface UpdateMerchantServiceInput {
  status?: MerchantServiceStatus;
  /** May be sent as `null` to clear (the DTO field is `@IsOptional()`). */
  activatedAt?: ISODateString | null;
  notes?: string | null;
}
