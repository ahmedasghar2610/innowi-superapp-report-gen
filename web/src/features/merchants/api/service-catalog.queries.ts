"use client";

import { useCatalogServices } from "@/features/catalog/queries";

/**
 * The catalogue behind the "Add service" picker.
 *
 * Was backed by `TEMP_SERVICE_CATALOG` (a hard-coded stand-in) while
 * `GET /services` didn't exist (API §12 gap). The Catalog API now ships that
 * endpoint, so this just re-exports `useCatalogServices` under the name every
 * existing consumer (`service-form-drawer.tsx`) already imports — same
 * `{ id, name, category }` shape, so nothing else needed to change.
 *
 * `features/merchants/data/service-catalog.ts` (the old hard-coded list) is
 * no longer read by anything and can be deleted once you've confirmed the
 * real catalogue ids line up with any data seeded under the old placeholder
 * ids.
 */
export const useServiceCatalog = useCatalogServices;
