"use client";

import { useQuery } from "@tanstack/react-query";
import { catalog } from "@/lib/api/resources/catalog";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { QueryOpts } from "@/lib/query/hook-types";
import type {
  CatalogPackage,
  CatalogService,
  CatalogEntitlement,
  CatalogEntitlementQuery,
  CatalogServiceQuery,
} from "./types";

/**
 * Catalog query hooks. The catalog rarely changes (it's the $199/$299 plan
 * definitions and the 14-service list), so these use a long staleTime rather
 * than the app default — no need to refetch on every mount.
 */
const CATALOG_STALE_TIME = 5 * 60_000;

/** GET /packages */
export function useCatalogPackages(options?: QueryOpts<CatalogPackage[]>) {
  return useQuery<CatalogPackage[], ApiError>({
    queryKey: queryKeys.catalog.packages(),
    queryFn: () => catalog.listPackages(),
    staleTime: CATALOG_STALE_TIME,
    ...options,
  });
}

/** GET /packages/:code */
export function useCatalogPackage(code: string | undefined, options?: QueryOpts<CatalogPackage>) {
  return useQuery<CatalogPackage, ApiError>({
    queryKey: queryKeys.catalog.package(code ?? ""),
    queryFn: () => catalog.getPackage(code as string),
    enabled: !!code,
    staleTime: CATALOG_STALE_TIME,
    ...options,
  });
}

/** GET /packages/:code/entitlements */
export function usePackageEntitlements(code: string | undefined, options?: QueryOpts<CatalogEntitlement[]>) {
  return useQuery<CatalogEntitlement[], ApiError>({
    queryKey: queryKeys.catalog.packageEntitlements(code ?? ""),
    queryFn: () => catalog.getPackageEntitlements(code as string),
    enabled: !!code,
    staleTime: CATALOG_STALE_TIME,
    ...options,
  });
}

/** GET /services — the "Add service" picker's data source. */
export function useCatalogServices(query?: CatalogServiceQuery, options?: QueryOpts<CatalogService[]>) {
  return useQuery<CatalogService[], ApiError>({
    queryKey: queryKeys.catalog.services(query ?? {}),
    queryFn: () => catalog.listServices(query),
    staleTime: CATALOG_STALE_TIME,
    ...options,
  });
}

/** GET /entitlements */
export function useCatalogEntitlements(query?: CatalogEntitlementQuery, options?: QueryOpts<CatalogEntitlement[]>) {
  return useQuery<CatalogEntitlement[], ApiError>({
    queryKey: queryKeys.catalog.entitlements(query ?? {}),
    queryFn: () => catalog.listEntitlements(query),
    staleTime: CATALOG_STALE_TIME,
    ...options,
  });
}
