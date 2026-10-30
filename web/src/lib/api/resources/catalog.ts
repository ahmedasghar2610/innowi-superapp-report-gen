import { api } from "../client";
import type {
  CatalogPackage,
  CatalogService,
  CatalogEntitlement,
  CatalogEntitlementQuery,
  CatalogServiceQuery,
} from "@/features/catalog/types";

/**
 * Standalone Catalog API — packages, services, and the entitlement matrix
 * between them. Read-only, open to every authenticated staff role. Replaces
 * the `TEMP_SERVICE_CATALOG` placeholder that `service-catalog.queries.ts`
 * used before this module existed.
 */
export type {
  CatalogPackage,
  CatalogService,
  CatalogEntitlement,
  CatalogEntitlementQuery,
  CatalogServiceQuery,
} from "@/features/catalog/types";

export const catalog = {
  /** GET /packages → the package list ($199/$299). */
  listPackages(): Promise<CatalogPackage[]> {
    return api.getList<CatalogPackage>("/packages");
  },

  /** GET /packages/:code → one package. */
  getPackage(code: string): Promise<CatalogPackage> {
    return api.get<CatalogPackage>(`/packages/${encodeURIComponent(code)}`);
  },

  /**
   * GET /packages/:code/entitlements → that package's full Service × Package
   * row set. The API returns the package *with* an `entitlements` array
   * (PackageDetailResponseDto), not a list envelope — unwrap that field.
   */
  getPackageEntitlements(code: string): Promise<CatalogEntitlement[]> {
    return api
      .get<CatalogPackage & { entitlements: CatalogEntitlement[] }>(`/packages/${encodeURIComponent(code)}/entitlements`)
      .then((r) => r.entitlements ?? []);
  },

  /** GET /services → the service catalog (filterable by category). */
  listServices(query?: CatalogServiceQuery): Promise<CatalogService[]> {
    return api.getList<CatalogService>("/services", query);
  },

  /** GET /services/:id → one service. */
  getService(id: string): Promise<CatalogService> {
    return api.get<CatalogService>(`/services/${id}`);
  },

  /** GET /entitlements → entitlement rows, filterable by package/service. */
  listEntitlements(query?: CatalogEntitlementQuery): Promise<CatalogEntitlement[]> {
    return api.getList<CatalogEntitlement>("/entitlements", query);
  },
};
