import type { Id, ISODateString } from "./enums";

/**
 * Merchant location (address + hours + NAP). A merchant can have several;
 * the API sorts primary-first. Maps to the workbook address/hours columns.
 * API_REFERENCE.md §6.
 */
export interface Location {
  id: Id;
  merchantId: Id;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  hours: string | null; // free text, e.g. "Mon–Fri 11:00–22:00"
  timezone: string | null; // IANA name, not validated
  isPrimary: boolean; // note: the API does not enforce a single primary
  /** Day-3 conflict-detection seam — a plain string you set yourself for now. */
  napStatus: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** CreateLocationDto — every field optional (a row may be created empty). */
export interface CreateLocationInput {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  hours?: string;
  timezone?: string;
  isPrimary?: boolean;
  napStatus?: string;
}

/**
 * UpdateLocationDto = Partial<Create>. Optional text fields may also be sent as
 * `null` to clear them (each is `@IsOptional()`); `isPrimary` stays boolean.
 */
export type UpdateLocationInput = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  hours?: string | null;
  timezone?: string | null;
  isPrimary?: boolean;
  napStatus?: string | null;
};
