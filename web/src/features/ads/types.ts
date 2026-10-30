/** Google Ads reporting — shapes returned by the API's /ads routes (modules/ads). */

export type RestaurantStatus = "active" | "paused" | "no_campaigns" | "archived";
export type AccountState = "active" | "archived" | "ignored";
export type Verification = "verified" | "required" | "failed" | "pending" | "not_required" | "unknown";
export type SyncState = "ok" | "issue" | "never";
export type BudgetStatus = "on_track" | "mismatch" | "no_budget";
export type RoasKey = "excellent" | "good" | "breakeven" | "unprofitable" | "na";
export type CampaignStatus = "ENABLED" | "PAUSED" | "REMOVED" | "UNKNOWN";

export interface Period {
  start: string;
  end: string;
  days: number;
}

export interface Metrics {
  spend: number;
  impressions: number;
  clicks: number;
  calls: number;
  directions: number;
  website: number;
  orders: number;
  menu: number;
}

export interface Kpis {
  revenue: number | null;
  costPerOrder: number | null;
  roi: number | null;
  roas: number | null;
}

export interface RoasStatus {
  key: RoasKey;
  label: string;
}

export interface Alert {
  type: "budget_mismatch" | "verification_required" | "sync_issue";
  label: string;
  severity: "warn" | "alert";
  detail: string;
}

export interface MerchantRef {
  /** null for sample accounts that behave as linked. */
  id: string | null;
  name: string;
}

export interface PortfolioRow extends Kpis {
  id: string;
  customerId: string;
  name: string;
  merchant: MerchantRef | null;
  source: "GOOGLE" | "SHEET" | "MANUAL" | "DEMO";
  isDemo: boolean;
  state: AccountState;
  restaurantStatus: RestaurantStatus;
  campaignSummary: string;
  campaignCounts: { active: number; paused: number };
  approvedMonthly: number | null;
  adsPaidBy: string | null;
  googleDailyBudget: number;
  city: string | null;
  hasData: boolean;
  metrics: Metrics;
  avgTicket: number | null;
  roasStatus: RoasStatus;
  verification: Verification;
  syncState: SyncState;
  lastSyncedAt: string | null;
  budgetStatus: BudgetStatus;
  alerts: Alert[];
  /** Only with compare=previous. */
  previous?: PeriodSummary;
}

export interface Portfolio {
  period: Period;
  comparePeriod: Period | null;
  reportPeriod: Period;
  budgetMonth: string;
  dataThrough: string | null;
  counts: {
    all: number;
    active: number;
    paused: number;
    budgetMismatch: number;
    verificationRequired: number;
    syncIssue: number;
    archived: number;
    unlinked: number;
  };
  rows: PortfolioRow[];
}

export interface Budget {
  month: string;
  monthStart: string;
  monthEnd: string;
  approvedMonthly: number | null;
  googleDailyBudget: number;
  combinedDailyBudget: number;
  monthToDateSpend: number;
  spendThrough: string | null;
  remaining: number | null;
  projectedMonthly: number;
  projectedAtPace: number;
  variance: number | null;
  variancePct: number | null;
  status: BudgetStatus;
  tolerancePct: number;
}

export interface Campaign extends Kpis {
  id: string;
  googleId: string;
  name: string;
  status: CampaignStatus;
  channelType: string | null;
  dailyBudget: number | null;
  startDate: string | null;
  endDate: string | null;
  hasData: boolean;
  metrics: Metrics;
  roasStatus: RoasStatus;
  analysis: string | null;
  previous?: PeriodSummary;
}

export interface AccountDetail extends PortfolioRow {
  period: Period;
  comparePeriod: Period | null;
  dataThrough: string | null;
  address: string | null;
  phone: string | null;
  gbp: { connected: boolean; listings: { id: string; title: string; city: string | null }[] };
  verificationMessage: string | null;
  verificationDeadline: string | null;
  syncError: string | null;
  syncWarning: string | null;
  currencyCode: string | null;
  ticketInputs: { totalSales: number | null; orderCount: number | null; updatedAt: string | null };
  analysis: string | null;
  budget: Budget;
  campaigns: Campaign[];
  tabCounts: { campaigns: number; assets: number; offers: number; sitelinks: number };
}

export type AssetKind = "text" | "image" | "logo" | "video" | "sitelink" | "promotion" | "callout" | "other";

export interface Asset {
  id: string;
  googleId: string;
  campaignId: string | null;
  campaignName: string | null;
  level: "campaign" | "account";
  fieldType: string;
  kind: AssetKind;
  status: "ENABLED" | "PAUSED" | "REMOVED" | "UNKNOWN";
  name: string | null;
  text: string | null;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
  details: {
    label?: string;
    youtubeId?: string | null;
    linkText?: string | null;
    description1?: string | null;
    description2?: string | null;
    finalUrl?: string | null;
    target?: string | null;
    discount?: string | null;
    code?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    occasion?: string | null;
  };
  syncedAt: string;
}

export interface ClientOffer {
  id: string;
  name: string | null;
  offerType: string | null;
  offerValue: string | null;
  code: string | null;
  channels: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
}

export interface Offers {
  merchantLinked: boolean;
  client: ClientOffer[];
  google: Asset[];
}

export interface BreakdownLine extends Kpis {
  hasData: boolean;
  metrics: Metrics;
  avgTicket: number | null;
  roasStatus: RoasStatus;
  analysis: string | null;
}

export interface Breakdown {
  month: string;
  monthStart: string;
  monthEnd: string;
  weeks: { label: string; start: string; end: string }[];
  rows: {
    campaign: { id: string; name: string; status: CampaignStatus; channelType: string | null };
    weeks: (BreakdownLine & { label: string; start: string; end: string })[];
    month: BreakdownLine;
  }[];
  total: BreakdownLine;
  months: string[];
}

export interface MonthlyReport {
  month: string;
  monthStart: string;
  monthEnd: string;
  rows: (Kpis & {
    accountId: string;
    accountName: string;
    customerId: string;
    campaignName: string;
    metrics: Metrics;
    avgTicket: number | null;
    roasStatus: RoasStatus;
    analysis: string;
  })[];
}

export interface UnmappedRow {
  id: string;
  customerId: string;
  name: string;
  source: PortfolioRow["source"];
  state: AccountState;
  campaigns: number;
  estMonthlySpend: number;
  mappingStatus: "needs_review" | "unmapped";
  suggestion: MerchantSuggestion | null;
  lastSeen: string | null;
  hasTicket: boolean;
}

export interface Unmapped {
  spendWindow: { start: string; end: string };
  summary: { total: number; needsReview: number; noMatch: number; monthlySpend: number };
  rows: UnmappedRow[];
}

export interface MerchantSuggestion {
  merchantId: string;
  name: string;
  city: string | null;
  score: number;
  reason: string;
}

export interface AccountListItem {
  id: string;
  customerId: string;
  name: string;
  source: PortfolioRow["source"];
  state: AccountState;
  merchant: { id: string; name: string | null } | null;
  lastSyncedAt: string | null;
  syncError: string | null;
}

export interface SyncRun {
  id: string;
  trigger: "manual" | "quick" | "schedule" | "connect" | "cli";
  /** quick: accounts, campaigns and daily metrics only; full: also assets, dates and verification. */
  mode: "quick" | "full";
  status: "running" | "success" | "partial" | "failed";
  startedAt: string;
  finishedAt: string | null;
  accounts: number;
  accountsFailed: number;
  metricRows: number;
  newAccounts: number;
  error: string | null;
}

export interface AdsStatus {
  missingEnv: string[];
  redirectUri: string;
  managerCustomerId: string | null;
  connected: boolean;
  connection: {
    email: string | null;
    status: "connected" | "error";
    error: string | null;
    connectedAt: string;
    connectedBy: string | null;
    lastSyncAt: string | null;
  } | null;
  lastRun: SyncRun | null;
  running: boolean;
  accounts: { google: number; sheet: number; demo: number };
  dataThrough: string | null;
  canManage: boolean;
  autoSync: { enabled: boolean; hour: number; timezone: string; nextAt: string | null };
  settings: { budgetTolerancePct: number; staleHours: number; historyDays: number };
}

export interface AdsComment {
  id: string;
  body: string;
  author: { id: string; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  canEdit: boolean;
}

export interface ImportResult {
  created: number;
  updated: number;
  linked: number;
  rows: { customerId: string; name: string; action: "created" | "updated"; sheetStatus: string; linkedMerchantId: string | null }[];
}

export interface PeriodQuery {
  start?: string;
  end?: string;
  /** "previous": also return the previous period (rows / campaigns get `previous`). */
  compare?: "previous";
}

/** The comparable numbers of the comparison period. */
export interface PeriodSummary extends Kpis {
  hasData: boolean;
  metrics: Metrics;
  roasStatus: RoasStatus;
}

export interface TrendPoint {
  date: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  calls: number | null;
  directions: number | null;
  website: number | null;
  menu: number | null;
  orders: number | null;
  /** null without an average ticket, or after the last synced day. */
  revenue: number | null;
}

export interface Trend {
  period: Period;
  comparePeriod: Period | null;
  dataThrough: string | null;
  avgTicket: number | null;
  campaignId: string | null;
  campaigns: { id: string; name: string; status: CampaignStatus }[];
  days: TrendPoint[];
  /** Same length as comparePeriod, aligned to `days` by position. */
  previousDays: TrendPoint[] | null;
}
