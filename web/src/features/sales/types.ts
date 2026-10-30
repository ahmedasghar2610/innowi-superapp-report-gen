/**
 * Sales module types — mirror api/app/schemas/sales.py (camelCase on the wire).
 * Money arrives as decimal strings ("642.00"); dates as ISO strings.
 */
import type { PagedEnvelope } from "@/types/api";
import type { Role, UserStatus } from "@/features/auth/types";

export interface SalesMe {
  configured: boolean;
  linked: boolean;
  sfUserId: string | null;
  sfUserName: string | null;
  seeAll: boolean;
  canManage: boolean;
  lastSyncAt: string | null;
  salesforceUrl: string | null;
}

export interface Deal {
  id: string;
  name: string;
  accountId: string | null;
  accountName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  stageName: string;
  columnKey: string;
  columnLabel: string;
  isOpen: boolean;
  isWon: boolean;
  amount: string | null;
  closeDate: string | null;
  recordTypeName: string | null;
  createdAt: string | null;
  lastModifiedAt: string | null;
  daysSinceChange: number | null;
  isStale: boolean;
  isStuck: boolean;
}

export interface PipelineColumn {
  key: string;
  label: string;
  isOpen: boolean;
  isWon: boolean;
  count: number;
  amount: string;
  deals: Deal[];
}

export interface Pipeline {
  columns: PipelineColumn[];
  openCount: number;
  openAmount: string;
  staleHidden: number;
}

export interface Visit {
  id: string;
  name: string | null;
  accountId: string | null;
  accountName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  visitType: string | null;
  status: string | null;
  address: string | null;
  dueDateStart: string | null;
  dueDateEnd: string | null;
  appointmentTime: string | null;
  completedDate: string | null;
  isOverdue: boolean;
}

export interface SupportCase {
  id: string;
  caseNumber: string | null;
  subject: string | null;
  status: string | null;
  origin: string | null;
  priority: string | null;
  accountId: string | null;
  accountName: string | null;
  ownerName: string | null;
  isClosed: boolean;
  createdAt: string | null;
  closedAt: string | null;
  issueCategory?: string | null;
  /** Recorded team, else estimated from the issue category (departmentSource says which). */
  department?: string | null;
  departmentSource?: CaseDepartmentSource | null;
  details?: string | null;
  resolutionType?: string | null;
}

export type CaseDepartmentSource = "recorded" | "estimated" | "unclassified";

export interface Contact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobilePhone: string | null;
}

export interface Touchpoint {
  id: string;
  healthStatus: string | null;
  latestStatus: string | null;
  latestTouchpointDate: string | null;
  ownerName: string | null;
}

export interface Customer {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  ownerName: string | null;
  health: string | null;
  lastTouchpointDate: string | null;
  openDeals: number;
  wonDeals: number;
  openCases: number;
}

export interface CustomerDetail extends Customer {
  website: string | null;
  street: string | null;
  postalCode: string | null;
  contacts: Contact[];
  deals: Deal[];
  visits: Visit[];
  cases: SupportCase[];
  touchpoints: Touchpoint[];
}

export interface DealDetail extends Deal {
  probability: string | null;
  leadSource: string | null;
  customer: CustomerDetail | null;
}

export interface Summary {
  today: string;
  counts: {
    openDeals: number;
    stuckDeals: number;
    staleDeals: number;
    visitsDueToday: number;
    visitsOverdue: number;
    visitsNext7Days: number;
    openCases: number;
  };
  stuckDeals: Deal[];
  visitsDue: Visit[];
  openCases: SupportCase[];
  lastSyncAt: string | null;
}

export interface Owner {
  id: string;
  name: string;
}

export interface TeamMember {
  sfUserId: string;
  name: string;
  email: string | null;
  isActive: boolean;
  lastSalesforceLogin: string | null;
  openDeals: number;
  staleDeals: number;
  dealsCreated30d: number;
  wonDeals: number;
  visitsPending: number;
  visitsCompleted30d: number;
  openCases: number;
  superappUserEmail: string | null;
}

export interface LinkedUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
}

export interface Person {
  sfUserId: string;
  name: string;
  email: string | null;
  profileName: string | null;
  isActive: boolean;
  lastSalesforceLogin: string | null;
  ownsDeals: number;
  ownsVisits: number;
  linkedUser: LinkedUser | null;
  suggestedUser: LinkedUser | null;
}

export interface CreatedLogin {
  person: Person;
  temporaryPassword: string;
}

export type SalesRole = "SALES_EXECUTIVE" | "SALES_MANAGER";

export interface SyncObject {
  objectName: string;
  recordCount: number;
  lastSuccessAt: string | null;
  lastModstamp: string | null;
  lastError: string | null;
}

export interface SyncRun {
  id: string;
  trigger: string;
  status: "running" | "success" | "partial" | "error" | "skipped" | string;
  startedAt: string;
  finishedAt: string | null;
  apiCalls: number;
  upserted: number;
  deleted: number;
  error: string | null;
}

export interface SyncStatus {
  configured: boolean;
  lastSuccessAt: string | null;
  apiCallsLast24h: number;
  objects: SyncObject[];
  runs: SyncRun[];
}

export interface MonthPoint {
  month: string; // "2026-10"
  count: number;
  amount: string;
}

export interface StageBar {
  key: string;
  label: string;
  count: number;
  amount: string;
}

export interface HealthSlice {
  status: string;
  count: number;
}

export interface Leader {
  ownerId: string;
  name: string;
  wonCount: number;
  wonAmount: string;
  openDeals: number;
}

export interface Insights {
  today: string;
  totals: {
    openDeals: number;
    openAmount: string;
    wonThisMonth: number;
    wonThisMonthAmount: string;
    wonLast12Months: number;
    wonLast12MonthsAmount: string;
    lostLast12Months: number;
    winRate: number | null;
    dealsWithoutAmount: number;
  };
  wonByMonth: MonthPoint[];
  newByMonth: MonthPoint[];
  pipelineByStage: StageBar[];
  health: HealthSlice[];
  leaderboard: Leader[];
}

/* ---- queries ------------------------------------------------------------ */
export interface OwnerQuery {
  ownerId?: string;
}
export interface PageQuery {
  page?: number;
  limit?: number;
}
export interface DealQuery extends OwnerQuery, PageQuery {
  search?: string;
  column?: string;
  state?: "open" | "closed" | "all";
  includeStale?: boolean;
  /** Open deals untouched 30 days-6 months (stuck) or 6+ months (stale) — the My Day counts. */
  quiet?: "stuck" | "stale";
}
export interface PipelineQuery extends OwnerQuery {
  includeStale?: boolean;
  closedWithinDays?: number;
  perColumn?: number;
}
export interface CustomerQuery extends OwnerQuery, PageQuery {
  search?: string;
  health?: string;
  onlyCustomers?: boolean;
}
export interface VisitQuery extends OwnerQuery, PageQuery {
  state?: "open" | "done" | "all";
  /** week = today + next 7 days; next7 = starting in the next 7 days (not today). */
  when?: "all" | "today" | "week" | "next7" | "overdue" | "upcoming";
  type?: string;
  search?: string;
}
/** The analysis filters; the case list takes the same ones, so a click lists what was counted. */
export interface CaseFilters {
  state?: "open" | "closed" | "all";
  search?: string;
  from?: string;
  to?: string;
  department?: string;
  category?: string;
  source?: CaseDepartmentSource;
  priority?: string;
  origin?: string;
  handledBy?: string;
}

export interface CaseQuery extends OwnerQuery, PageQuery, CaseFilters {}

export interface CaseGroup {
  key: string;
  count: number;
  open: number;
  medianHoursToClose: number | null;
}

export interface CaseInsights {
  totals: {
    cases: number;
    open: number;
    medianHoursToClose: number | null;
    categorised: number;
    departmentRecorded: number;
    departmentEstimated: number;
    departmentUnclassified: number;
    firstCreated: string | null;
    lastCreated: string | null;
  };
  byDepartment: CaseGroup[];
  byCategory: (CaseGroup & { department: string })[];
  bySource: CaseGroup[];
  byPriority: CaseGroup[];
  byOrigin: CaseGroup[];
  byStatus: CaseGroup[];
  byHandler: (CaseGroup & { id: string })[];
  byResolution: CaseGroup[];
  byMonth: { month: string; department: string; count: number }[];
  matrix: { department: string; category: string; count: number }[];
  topRestaurants: { id: string; key: string; count: number; open: number }[];
  subjectWords: { key: string; count: number }[];
  mapping: { category: string; department: string }[];
}

export type DealPage = PagedEnvelope<Deal>;
export type CustomerPage = PagedEnvelope<Customer>;
export type VisitPage = PagedEnvelope<Visit>;
export type CasePage = PagedEnvelope<SupportCase>;
