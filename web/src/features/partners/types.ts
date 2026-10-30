/**
 * Partner leads — applications from partners.innowi.com (ISOs, agents and
 * resellers who want to sell Innowi). Mirrors the API's
 * app/schemas/partner_leads.py. The rows belong to the partner portal; the
 * Super App reads them and can change status / owner and add notes.
 */

export const PARTNER_LEAD_STATUSES = ["new", "contacted", "qualified", "proposal", "won", "lost", "spam"] as const;
export type PartnerLeadStatus = (typeof PARTNER_LEAD_STATUSES)[number];

export interface PartnerLead {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: PartnerLeadStatus;
  fullName: string;
  title: string | null;
  company: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  partnerType: string | null;
  region: string | null;
  portfolioSize: string | null;
  restaurantShare: string | null;
  processors: string | null;
  interests: string[];
  timeline: string | null;
  heardAbout: string | null;
  message: string | null;
  wantsCall: boolean;
  sourceCta: string | null;
  landingUrl: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  assignedTo: string | null;
  assignedAt: string | null;
  lastContactedAt: string | null;
  notifiedAt: string | null;
  teamsNotifiedAt: string | null;
}

export interface PartnerLeadNote {
  id: string;
  authorEmail: string;
  body: string;
  createdAt: string;
}

export interface PartnerLeadEvent {
  id: string;
  actorEmail: string | null;
  type: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface PartnerLeadDetail extends PartnerLead {
  notes: PartnerLeadNote[];
  events: PartnerLeadEvent[];
}

/**
 * Someone on the partner team. The team is built from the Super App's people:
 * everyone signed up or invited with a role that can work leads ("active" /
 * "invited"), plus known names that can't take leads right now (no login, turned
 * off, or another role) so old owners and notes still show a name.
 */
export interface PartnerTeamMember {
  email: string;
  name: string | null;
  role: string;
  superAppRole: string | null;
  assignable: boolean;
  receivesNewLeads: boolean;
  status: "active" | "invited" | "no_login" | "inactive" | "other_role";
}

export interface UpdatePartnerTeamMemberInput {
  /** null = back to the role's default (on for sales roles, off for admins). */
  assignable?: boolean | null;
  receivesNewLeads?: boolean;
}

export interface PartnerLeadSummary {
  total: number;
  unassigned: number;
  last7Days: number;
  byStatus: { key: string; count: number }[];
  bySource: { key: string; count: number }[];
}

export type PartnerLeadSort = "createdAt" | "name" | "company" | "status" | "owner";

export interface PartnerLeadQuery {
  page?: number;
  limit?: number;
  order?: "asc" | "desc";
  sortBy?: PartnerLeadSort;
  q?: string;
  status?: PartnerLeadStatus;
  source?: string;
  /** An owner's email, or "unassigned". */
  assignedTo?: string;
  includeSpam?: boolean;
}

export interface UpdatePartnerLeadInput {
  status?: PartnerLeadStatus;
  /** null unassigns. */
  assignedTo?: string | null;
}
