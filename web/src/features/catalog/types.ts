import type { Id, ServiceCategory } from "@/features/merchants/types";

/**
 * Catalog API types (previously a known gap — API_REFERENCE.md §12 — now
 * live as a standalone CatalogModule: GET /packages, /packages/:code,
 * /packages/:code/entitlements, /services, /services/:id, /entitlements).
 */

export interface CatalogPackage {
  code: string; // e.g. "$199", "$299"
  name: string;
  price: string; // decimal string
}

export interface CatalogService {
  id: Id;
  name: string;
  category: ServiceCategory;
}

/**
 * One row of the Service × Package entitlement matrix (workbook
 * "Entitlements" tab: Included in $199/$299, Qty/Period, Frequency).
 */
export interface CatalogEntitlement {
  packageCode: string;
  serviceId: Id;
  serviceName: string;
  included: boolean;
  quantityPerPeriod: number | null;
  frequency: string | null;
}

export interface CatalogEntitlementQuery {
  packageCode?: string;
  serviceId?: Id;
}

export interface CatalogServiceQuery {
  category?: ServiceCategory;
}
