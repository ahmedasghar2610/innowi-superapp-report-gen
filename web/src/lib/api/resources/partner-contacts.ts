import { api } from "../client";
import type { PagedEnvelope } from "@/types/api";
import type {
  CreatePartnerContactInput,
  PartnerContact,
  PartnerContactQuery,
  PartnerContactSummary,
  PromotedContact,
  UpdatePartnerContactInput,
} from "@/features/partners/contacts/types";

/** /partner-contacts — the partner network (API: app/modules/partner_contacts). */
export const partnerContacts = {
  list(query?: PartnerContactQuery): Promise<PagedEnvelope<PartnerContact>> {
    return api.getPage<PartnerContact>("/partner-contacts", query);
  },
  summary(): Promise<PartnerContactSummary> {
    return api.get<PartnerContactSummary>("/partner-contacts/summary");
  },
  get(id: string): Promise<PartnerContact> {
    return api.get<PartnerContact>(`/partner-contacts/${id}`);
  },
  create(input: CreatePartnerContactInput): Promise<PartnerContact> {
    return api.post<PartnerContact>("/partner-contacts", input);
  },
  update(id: string, input: UpdatePartnerContactInput): Promise<PartnerContact> {
    return api.patch<PartnerContact>(`/partner-contacts/${id}`, input);
  },
  promote(id: string, partnerType?: string | null): Promise<PromotedContact> {
    return api.post<PromotedContact>(`/partner-contacts/${id}/promote`, partnerType ? { partnerType } : {});
  },
};
