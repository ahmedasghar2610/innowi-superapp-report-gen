import type { ContactRole, Id, ISODateString, PreferredChannel, Responsiveness } from "./enums";

/**
 * Merchant contact (owner, marketing, content approver, billing, catering).
 * Maps to the workbook "Merchants" tab contact columns. API_REFERENCE.md §5.
 */
export interface Contact {
  id: Id;
  merchantId: Id;
  name: string | null;
  role: ContactRole;
  email: string | null;
  phone: string | null; // free text, not format-validated
  preferredChannel: PreferredChannel | null;
  language: string | null;
  responsiveness: Responsiveness | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** CreateContactDto — `role` is the only required field. */
export interface CreateContactInput {
  role: ContactRole;
  name?: string;
  email?: string; // valid email, ≤ 320
  phone?: string;
  preferredChannel?: PreferredChannel;
  language?: string;
  responsiveness?: Responsiveness;
}

/**
 * UpdateContactDto = Partial<Create> (role optional on update). Optional fields
 * may also be sent as `null` to clear them (the DTO marks them `@IsOptional()`).
 */
export type UpdateContactInput = {
  role?: ContactRole;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  preferredChannel?: PreferredChannel | null;
  language?: string | null;
  responsiveness?: Responsiveness | null;
};
