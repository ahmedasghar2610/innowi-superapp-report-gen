import { api } from "../client";
import type { PagedEnvelope } from "@/types/api";
import type {
  AddAgentsResult,
  AgentInput,
  AssignInput,
  AssignResult,
  OrganizationLinks,
  CreateDealInput,
  CreateOrganizationInput,
  DealBoard,
  DealDetail,
  DealQuery,
  DealRow,
  Organization,
  OrganizationContact,
  OrganizationContactInput,
  OrganizationDetail,
  OrganizationQuery,
  UpdateDealInput,
  UpdateOrganizationInput,
} from "@/features/deals/types";

/** /deals — the pipeline (API: app/modules/deals). */
export const deals = {
  list(query?: DealQuery): Promise<PagedEnvelope<DealRow>> {
    return api.getPage<DealRow>("/deals", query);
  },
  board(query?: DealQuery): Promise<DealBoard> {
    return api.get<DealBoard>("/deals/board", query);
  },
  get(id: string): Promise<DealDetail> {
    return api.get<DealDetail>(`/deals/${id}`);
  },
  create(input: CreateDealInput): Promise<DealDetail> {
    return api.post<DealDetail>("/deals", input);
  },
  update(id: string, input: UpdateDealInput): Promise<DealDetail> {
    return api.patch<DealDetail>(`/deals/${id}`, input);
  },
  addNote(id: string, body: string): Promise<DealDetail> {
    return api.post<DealDetail>(`/deals/${id}/notes`, { body });
  },
  linkQuote(id: string, linkId: string): Promise<DealDetail> {
    return api.post<DealDetail>(`/deals/${id}/link-quote`, { linkId });
  },
};

/** /organizations — ISOs, agents, resellers, contractors. */
export const organizations = {
  list(query?: OrganizationQuery): Promise<PagedEnvelope<Organization>> {
    return api.getPage<Organization>("/organizations", query);
  },
  get(id: string): Promise<OrganizationDetail> {
    return api.get<OrganizationDetail>(`/organizations/${id}`);
  },
  create(input: CreateOrganizationInput): Promise<OrganizationDetail> {
    return api.post<OrganizationDetail>("/organizations", input);
  },
  update(id: string, input: UpdateOrganizationInput): Promise<OrganizationDetail> {
    return api.patch<OrganizationDetail>(`/organizations/${id}`, input);
  },
  addContact(id: string, input: OrganizationContactInput): Promise<OrganizationContact> {
    return api.post<OrganizationContact>(`/organizations/${id}/contacts`, input);
  },
  updateContact(id: string, contactId: string, input: OrganizationContactInput): Promise<OrganizationContact> {
    return api.patch<OrganizationContact>(`/organizations/${id}/contacts/${contactId}`, input);
  },
  removeContact(id: string, contactId: string): Promise<void> {
    return api.del(`/organizations/${id}/contacts/${contactId}`);
  },
  addNote(id: string, body: string): Promise<OrganizationDetail> {
    return api.post<OrganizationDetail>(`/organizations/${id}/notes`, { body });
  },
  addAgents(id: string, agents: AgentInput[], dryRun = false): Promise<AddAgentsResult> {
    return api.post<AddAgentsResult>(`/organizations/${id}/agents`, { agents, dryRun });
  },
  assign(input: AssignInput): Promise<AssignResult> {
    return api.post<AssignResult>("/organizations/assign", input);
  },
  fromLead(leadId: string, organizationId?: string): Promise<OrganizationDetail> {
    return api.post<OrganizationDetail>(`/organizations/from-lead/${leadId}`, organizationId ? { organizationId } : {});
  },
  fromCard(contactId: string, organizationId?: string): Promise<OrganizationDetail> {
    return api.post<OrganizationDetail>(`/organizations/from-card/${contactId}`, organizationId ? { organizationId } : {});
  },
  links(leadIds: string[], contactIds: string[]): Promise<OrganizationLinks> {
    return api.get<OrganizationLinks>("/organizations/links", { leadIds: leadIds.join(","), contactIds: contactIds.join(",") });
  },
};
