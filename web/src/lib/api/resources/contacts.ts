import { api } from "../client";
import type { Contact, CreateContactInput, UpdateContactInput } from "@/features/merchants/types";

/* Contacts — flat item routes; list/create nested under the merchant. §5. */
export type {
  Contact,
  ContactRole,
  PreferredChannel,
  Responsiveness,
  CreateContactInput,
  UpdateContactInput,
} from "@/features/merchants/types";

export const contacts = {
  /** GET /merchants/:merchantId/contacts (not paginated). */
  list(merchantId: string): Promise<Contact[]> {
    return api.getList<Contact>(`/merchants/${merchantId}/contacts`);
  },

  /** POST /merchants/:merchantId/contacts — do NOT put merchantId in the body. */
  create(merchantId: string, input: CreateContactInput): Promise<Contact> {
    return api.post<Contact>(`/merchants/${merchantId}/contacts`, input);
  },

  /** PATCH /contacts/:id (flat, globally-unique id). */
  update(id: string, input: UpdateContactInput): Promise<Contact> {
    return api.patch<Contact>(`/contacts/${id}`, input);
  },

  /** DELETE /contacts/:id → 204. */
  remove(id: string): Promise<void> {
    return api.del(`/contacts/${id}`);
  },
};
