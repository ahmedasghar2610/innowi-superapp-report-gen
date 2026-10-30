/**
 * Partner network — people met at conferences (business cards scanned by the
 * card agent), imported, or added by hand. Mirrors the API's
 * app/schemas/partner_contacts.py. A contact is NOT a lead: the team promotes
 * the ones that look like partner prospects, which creates the partner lead.
 */

export const PARTNER_CONTACT_STATUSES = ["new", "potential_partner", "not_a_fit", "customer", "vendor", "other"] as const;
export type PartnerContactStatus = (typeof PARTNER_CONTACT_STATUSES)[number];

export const PARTNER_CONTACT_SOURCES = ["business-card", "manual", "import"] as const;
export type PartnerContactSource = (typeof PARTNER_CONTACT_SOURCES)[number];

/** Same options as the application form on partners.innowi.com. */
export const PARTNER_TYPES = [
  "ISO / agent organization",
  "Independent sales agent",
  "Bank or financial institution",
  "Payment gateway or processor",
  "Restaurant consultant or POS dealer",
  "Other",
] as const;

export interface PartnerContact {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: PartnerContactStatus;
  fullName: string;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  partnerType: string | null;
  notes: string | null;
  tags: string[];
  metAt: string | null;
  metOn: string | null;
  source: PartnerContactSource;
  scannedBy: string | null;
  cardId: string | null;
  otherText: string | null;
  photoUrl: string | null;
  batchId: string | null;
  promotedLeadId: string | null;
  promotedAt: string | null;
  promotedBy: string | null;
}

export interface PartnerContactSummary {
  total: number;
  unreviewed: number;
  promoted: number;
  last7Days: number;
  byStatus: { key: string; count: number }[];
  byEvent: { key: string; count: number }[];
}

export type PartnerContactSort = "createdAt" | "name" | "company" | "metOn" | "status";

export interface PartnerContactQuery {
  page?: number;
  limit?: number;
  order?: "asc" | "desc";
  sortBy?: PartnerContactSort;
  q?: string;
  status?: PartnerContactStatus;
  event?: string;
  source?: PartnerContactSource;
  promoted?: boolean;
}

export interface UpdatePartnerContactInput {
  status?: PartnerContactStatus;
  fullName?: string;
  title?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  partnerType?: string | null;
  notes?: string | null;
  tags?: string[];
  metAt?: string | null;
  metOn?: string | null;
}

export interface CreatePartnerContactInput {
  fullName: string;
  title?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  partnerType?: string | null;
  notes?: string | null;
  tags?: string[];
  metAt?: string | null;
  metOn?: string | null;
}

export interface PromotedContact {
  contact: PartnerContact;
  leadId: string;
}
