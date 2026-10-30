import { api } from "../client";
import type { PagedEnvelope } from "@/types/api";
import type {
  PartnerLead,
  PartnerLeadDetail,
  PartnerLeadNote,
  PartnerLeadQuery,
  PartnerLeadSummary,
  PartnerTeamMember,
  UpdatePartnerLeadInput,
  UpdatePartnerTeamMemberInput,
} from "@/features/partners/types";

/** /partner-leads — applications from partners.innowi.com (API: app/modules/partner_leads). */
export const partnerLeads = {
  list(query?: PartnerLeadQuery): Promise<PagedEnvelope<PartnerLead>> {
    return api.getPage<PartnerLead>("/partner-leads", query);
  },
  summary(): Promise<PartnerLeadSummary> {
    return api.get<PartnerLeadSummary>("/partner-leads/summary");
  },
  team(): Promise<PartnerTeamMember[]> {
    return api.getList<PartnerTeamMember>("/partner-leads/team");
  },
  updateTeamMember(email: string, input: UpdatePartnerTeamMemberInput): Promise<PartnerTeamMember> {
    return api.patch<PartnerTeamMember>(`/partner-leads/team/${encodeURIComponent(email)}`, input);
  },
  get(id: string): Promise<PartnerLeadDetail> {
    return api.get<PartnerLeadDetail>(`/partner-leads/${id}`);
  },
  update(id: string, input: UpdatePartnerLeadInput): Promise<PartnerLead> {
    return api.patch<PartnerLead>(`/partner-leads/${id}`, input);
  },
  addNote(id: string, body: string): Promise<PartnerLeadNote> {
    return api.post<PartnerLeadNote>(`/partner-leads/${id}/notes`, { body });
  },
};
