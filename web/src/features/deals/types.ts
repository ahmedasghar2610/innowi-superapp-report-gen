/** The spine — organizations and deals. Mirrors api/app/schemas/deals.py. */

import type { MerchantStatus, PersonRef } from "@/features/churn/types";

export type { MerchantStatus, PersonRef };

export const ORGANIZATION_KINDS = ["PARTNER_ISO", "PARTNER_AGENT", "PARTNER_RESELLER", "CONTRACTOR", "OTHER"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const ORGANIZATION_STATUSES = ["PROSPECT", "ACTIVE", "INACTIVE"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/** The partner journey (api: modules/deals/partners.py). NOT_INTERESTED sits outside the order. */
export const PARTNER_STAGES = [
  "NEW",
  "DEMO_SCHEDULED",
  "DEMO_HELD",
  "NDA_SENT",
  "NDA_SIGNED",
  "AGREEMENT_SENT",
  "AGREEMENT_SIGNED",
  "COLLATERAL_SENT",
  "IU_ENROLLED",
  "CERTIFIED",
] as const;
export type PartnerStage = (typeof PARTNER_STAGES)[number] | "NOT_INTERESTED";
export const ALL_PARTNER_STAGES: readonly PartnerStage[] = [...PARTNER_STAGES, "NOT_INTERESTED"];

/** Where the partner relationship started. */
export const CAME_FROM = ["ELAVON", "BMO", "DIRECT", "CONFERENCE", "INBOUND_PARTNER", "INBOUND_SUPPORT", "INBOUND_GENERIC"] as const;
export type CameFrom = (typeof CAME_FROM)[number];

export type OrgSortBy = "name" | "createdAt" | "updatedAt" | "stage" | "owner" | "deals" | "agents" | "nextStepDue" | "cameFrom";

/** Pipeline order; LOST sits outside it. */
export const DEAL_STAGES = [
  "NEW",
  "DEMO_BOOKED",
  "DEMO_DONE",
  "QUOTE_SENT",
  "ORDER_FORM_SIGNED",
  "PROCESSOR_SETUP",
  "MENU",
  "READY_TO_DEPLOY",
  "DEPLOYED",
  "LIVE",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number] | "LOST";
export const ALL_STAGES: readonly DealStage[] = [...DEAL_STAGES, "LOST"];

export type DeployedBy = "INNOWI" | "CONTRACTOR";
export type HiredBy = "INNOWI" | "PARTNER";
export type DealEventKind = "CREATED" | "STAGE_CHANGED" | "NOTE" | "QUOTE_LINKED" | "QUOTE_EXECUTED" | "OWNER_CHANGED";
export type DealBucket = "OPEN" | "WON" | "LOST" | "ALL";

export interface OrgRef {
  id: string;
  name: string;
  kind: OrganizationKind;
}

export interface OrganizationContact {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export interface OrganizationContactInput {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export interface Organization {
  id: string;
  name: string;
  kind: OrganizationKind;
  status: OrganizationStatus;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  certified: boolean;
  certifiedAt: string | null;
  partnerLeadId: string | null;
  /** Where the record came from (features/sources/labels.ts); null = not recorded. */
  source: string | null;
  /** The file or partner lead behind it. */
  sourceDetail: string | null;
  stage: PartnerStage;
  stageChangedAt: string | null;
  iuEnrolledAt: string | null;
  cameFrom: CameFrom | null;
  /** Who introduced them, or the conference. */
  cameFromDetail: string | null;
  owner: PersonRef | null;
  assignedAt: string | null;
  nextStep: string | null;
  nextStepDue: string | null;
  /** Stage / came-from were filled in from a spreadsheet and nobody has confirmed them yet. */
  needsReview: boolean;
  salesforceAccountId: string | null;
  /** The ISO an agent works under. */
  parent: OrgRef | null;
  agentCount: number;
  agentsIuEnrolled: number;
  agentsCertified: number;
  agentsSelling: number;
  /** At least one deal in the last 30 days (an ISO: itself or any of its agents). */
  selling: boolean;
  dealsLast30: number;
  dealCount: number;
  liveCount: number;
  primaryContact: OrganizationContact | null;
  createdAt: string;
  updatedAt: string;
}

export type OrganizationEventKind =
  | "CREATED"
  | "STAGE_CHANGED"
  | "OWNER_CHANGED"
  | "CAME_FROM_CHANGED"
  | "LINKED"
  | "NOTE"
  | "AGENT_ADDED";

export interface OrganizationEvent {
  id: string;
  kind: OrganizationEventKind;
  fromValue: string | null;
  toValue: string | null;
  body: string | null;
  actor: PersonRef | null;
  createdAt: string;
}

export interface OrganizationDetail extends Organization {
  contacts: OrganizationContact[];
  deals: DealRow[];
  events: OrganizationEvent[];
}

export interface OrganizationQuery {
  page?: number;
  limit?: number;
  search?: string;
  kind?: OrganizationKind;
  status?: OrganizationStatus;
  certified?: boolean;
  /** A source key, or "NONE" for records with none recorded. */
  source?: string;
  stage?: PartnerStage;
  cameFrom?: CameFrom | "NONE";
  /** A user id, "me" or "none". */
  ownerId?: string;
  parentId?: string;
  topLevel?: boolean;
  needsReview?: boolean;
  selling?: boolean;
  sortBy?: OrgSortBy;
  order?: "asc" | "desc";
}

export interface CreateOrganizationInput {
  name: string;
  kind: OrganizationKind;
  status?: OrganizationStatus;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
  partnerLeadId?: string;
  stage?: PartnerStage;
  cameFrom?: CameFrom;
  cameFromDetail?: string;
  parentId?: string;
  ownerId?: string;
  nextStep?: string;
  nextStepDue?: string;
  contacts?: OrganizationContactInput[];
}

export interface UpdateOrganizationInput {
  name?: string;
  kind?: OrganizationKind;
  status?: OrganizationStatus;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
  certified?: boolean;
  partnerLeadId?: string;
  stage?: PartnerStage;
  cameFrom?: CameFrom;
  cameFromDetail?: string;
  clearCameFrom?: boolean;
  parentId?: string;
  clearParent?: boolean;
  ownerId?: string;
  clearOwner?: boolean;
  nextStep?: string;
  /** null clears the date. */
  nextStepDue?: string | null;
  clearNextStep?: boolean;
  salesforceAccountId?: string;
  clearSalesforce?: boolean;
}

export interface AgentInput {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
}

export interface AddAgentsResult {
  created: number;
  skipped: { row: number; name: string; reason: string }[];
  dryRun: boolean;
}

export interface AssignInput {
  organizationIds?: string[];
  parentId?: string;
  onlyUnassigned?: boolean;
  /** Leave every count out to split evenly. */
  people: { userId: string; count?: number }[];
  keepTogether?: "state" | "city" | "none";
  balanceLoad?: boolean;
  dryRun?: boolean;
}

export interface AssignResult {
  dryRun: boolean;
  total: number;
  assigned: number;
  leftOver: number;
  skippedAlreadyOwned: number;
  people: { user: PersonRef; target: number; count: number; existing: number; groups: string[]; sample: string[] }[];
}

export interface OrganizationLinks {
  leads: Record<string, OrgRef>;
  cards: Record<string, OrgRef>;
}

export interface DealEvent {
  id: string;
  kind: DealEventKind;
  fromStage: DealStage | null;
  toStage: DealStage | null;
  body: string | null;
  actor: PersonRef | null;
  createdAt: string;
}

export interface DealQuote {
  linkId: string;
  mode: "SHOW_PRICES" | "HIDE_PRICES";
  linkStatus: "ACTIVE" | "REVOKED";
  createdAt: string;
  requestId: string | null;
  requestNumber: string | null;
  requestStatus: string | null;
  oneTimeTotal: string | null;
  monthlyTotal: string | null;
}

export interface DealRow {
  id: string;
  key: string;
  number: number;
  merchantId: string;
  restaurantName: string;
  merchantStatus: MerchantStatus;
  region: string | null;
  organization: OrgRef | null;
  owner: PersonRef | null;
  stage: DealStage;
  stageChangedAt: string;
  source: string | null;
  lostReason: string | null;
  amountMonthly: string | null;
  amountOneTime: string | null;
  demoAt: string | null;
  deploymentDate: string | null;
  deployedBy: DeployedBy | null;
  contractor: OrgRef | null;
  hiredBy: HiredBy | null;
  goLiveDate: string | null;
  quoteCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DealDetail extends DealRow {
  notes: string | null;
  events: DealEvent[];
  quotes: DealQuote[];
}

export interface DealQuery {
  page?: number;
  limit?: number;
  search?: string;
  stage?: DealStage;
  bucket?: DealBucket;
  ownerId?: string;
  mine?: boolean;
  organizationId?: string;
  merchantId?: string;
  sortBy?: "updatedAt" | "createdAt" | "stageChangedAt" | "restaurantName" | "amountMonthly" | "number";
  order?: "asc" | "desc";
}

export interface NewMerchantInput {
  restaurantName: string;
  region?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface CreateDealInput {
  merchantId?: string;
  newMerchant?: NewMerchantInput;
  organizationId?: string;
  ownerId?: string;
  stage?: DealStage;
  source?: string;
  demoAt?: string;
  notes?: string;
}

export interface UpdateDealInput {
  stage?: DealStage;
  lostReason?: string;
  ownerId?: string;
  clearOwner?: boolean;
  organizationId?: string;
  clearOrganization?: boolean;
  source?: string;
  amountMonthly?: string;
  amountOneTime?: string;
  demoAt?: string;
  clearDemoAt?: boolean;
  deploymentDate?: string;
  clearDeploymentDate?: boolean;
  deployedBy?: DeployedBy;
  contractorOrganizationId?: string;
  clearContractor?: boolean;
  hiredBy?: HiredBy;
  goLiveDate?: string;
  notes?: string;
}

export interface StageColumn {
  stage: DealStage;
  count: number;
  monthly: string;
  deals: DealRow[];
}

export interface DealBoard {
  columns: StageColumn[];
  total: number;
  lost: number;
  live: number;
  owners: PersonRef[];
  organizations: OrgRef[];
}
