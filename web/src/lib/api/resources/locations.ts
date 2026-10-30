import { api } from "../client";
import type { Location, CreateLocationInput, UpdateLocationInput } from "@/features/merchants/types";

/* Locations — every field optional; sorted primary-first by the API. §6. */
export type { Location, CreateLocationInput, UpdateLocationInput } from "@/features/merchants/types";

export const locations = {
  /** GET /merchants/:merchantId/locations (not paginated). */
  list(merchantId: string): Promise<Location[]> {
    return api.getList<Location>(`/merchants/${merchantId}/locations`);
  },

  /** POST /merchants/:merchantId/locations. */
  create(merchantId: string, input: CreateLocationInput = {}): Promise<Location> {
    return api.post<Location>(`/merchants/${merchantId}/locations`, input);
  },

  /** PATCH /locations/:id. */
  update(id: string, input: UpdateLocationInput): Promise<Location> {
    return api.patch<Location>(`/locations/${id}`, input);
  },

  /** DELETE /locations/:id → 204. Documents survive (locationId set null). */
  remove(id: string): Promise<void> {
    return api.del(`/locations/${id}`);
  },
};
