/** Google Business Profile reporting — shapes returned by the API's /gbp routes (modules/gbp). */

export type Change = { kind: "pct"; value: number } | { kind: "new" } | { kind: "flat" } | { kind: "na" };

export type OpenStatus = "OPEN" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | "UNKNOWN";
export type Verification = "verified" | "pending" | "required" | "unknown";
export type SyncState = "ok" | "delayed" | "failed";

export interface DateRange {
  start: string;
  end: string;
  days: number;
}

export interface LocationRef {
  id: string;
  title: string;
  city: string | null;
  storeCode: string | null;
}

export interface SyncRun {
  id: string;
  trigger: "manual" | "schedule" | "connect";
  status: "running" | "success" | "partial" | "failed";
  startedAt: string;
  finishedAt: string | null;
  locations: number;
  locationsFailed: number;
  metricDays: number;
  reviews: number;
  error: string | null;
}

export interface GbpStatus {
  missingEnv: string[];
  redirectUri: string;
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
  locations: { google: number; demo: number };
  dataThrough: string | null;
  canManage: boolean;
  /** Daily automatic refresh inside the API (GBP_AUTO_SYNC*). */
  autoSync: { enabled: boolean; hour: number; timezone: string; nextAt: string | null };
}

export interface Flag {
  code: string;
  label: string;
  detail: string;
}

export interface OverviewRow extends LocationRef {
  merchant: { id: string; name: string } | null;
  openStatus: OpenStatus;
  verification: Verification;
  syncState: SyncState;
  isNew: boolean;
  isDemo: boolean;
  hasData: boolean;
  missingDays: number | null;
  total: number | null;
  website: number | null;
  calls: number | null;
  directions: number | null;
  menu: number | null;
  orders: number | null;
  views: number | null;
  newReviews: number;
  totalReviews: number;
  rating: number | null;
  profilePct: number;
}

export interface Total {
  current: number | null;
  previous: number | null;
  change: Change;
}

export interface Overview {
  range: DateRange;
  previous: DateRange;
  dataThrough: string | null;
  summary: {
    total: number;
    open: number;
    temporarilyClosed: number;
    permanentlyClosed: number;
    verification: Record<Verification, number>;
    syncIssues: number;
    unlinked: number;
    demo: number;
  };
  totals: Record<"total" | "views" | "website" | "calls" | "directions", Total>;
  topPerformers: { key: string; label: string; location: LocationRef | null; value: number | null }[];
  attention: { location: LocationRef & { openStatus: OpenStatus; syncState: SyncState }; flags: Flag[] }[];
  flagCounts: Record<string, number>;
  rows: OverviewRow[];
}

export interface SeriesPoint {
  date: string;
  total: number | null;
  website: number | null;
  calls: number | null;
  directions: number | null;
  menu: number | null;
  orders: number | null;
  views: number | null;
}

export interface KeywordRow {
  keyword: string;
  impressions: number | null;
  threshold: number | null;
  previous: number | null;
  previousThreshold: number | null;
  change: Change;
}

export interface PostItem {
  id: string;
  type: string;
  title: string;
  date: string;
  state: string;
  url: string | null;
}

export interface OfferItem extends PostItem {
  summary: string | null;
  start: string | null;
  end: string | null;
  coupon: string | null;
  status: "Active" | "Scheduled" | "Expired";
}

export interface LocationReport {
  location: LocationRef & {
    address: string;
    phone: string | null;
    websiteUrl: string | null;
    menuUrl: string | null;
    orderingUrl: string | null;
    mapsUri: string | null;
    primaryCategory: string | null;
    openStatus: OpenStatus;
    verification: Verification;
    syncState: SyncState;
    syncError: string | null;
    syncWarning: string | null;
    lastSyncedAt: string | null;
    lastMetricsDate: string | null;
    firstDataDate: string | null;
    merchant: { id: string; name: string } | null;
    isDemo: boolean;
  };
  range: DateRange;
  previous: DateRange;
  dataThrough: string | null;
  daysWithData: number;
  missingDays: number;
  kpis: Record<"total" | "website" | "calls" | "directions" | "menu" | "orders" | "bookings", Total>;
  visibility: { search: Total; maps: Total; mobile: number | null; desktop: number | null };
  series: SeriesPoint[];
  /** Same length as the previous range; aligned to `series` by position. */
  previousSeries: SeriesPoint[];
  insights: string[];
  keywords: { months: string[]; month: string | null; previousMonth: string | null; rows: KeywordRow[]; total: number };
  reviews: {
    total: number;
    average: number | null;
    inRange: number;
    previousRange: number;
    change: Change;
    unansweredInRange: number;
    thisMonth: number;
    distribution: { stars: number; count: number }[];
    ratingAtPreviousEnd: number | null;
    ratingAtEnd: number | null;
    recent: { rating: number | null; comment: string | null; reviewer: string | null; date: string; hasReply: boolean }[];
  };
  profile: { pct: number; fields: { key: string; label: string; done: boolean }[] };
  posts: { total: number; inRange: number; latest: string | null; items: PostItem[]; offers: OfferItem[] };
}

export interface GbpNote {
  id: string;
  body: string;
  author: { id: string; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  canEdit: boolean;
}

export interface MerchantSuggestion {
  merchantId: string;
  name: string;
  city: string | null;
  score: number;
  reasons: string[];
}

export interface MerchantListing extends LocationRef {
  openStatus: OpenStatus;
  verification: Verification;
  syncState: SyncState;
  rating: number | null;
  totalReviews: number | null;
  total: number | null;
  views: number | null;
}

export interface RangeQuery {
  start?: string;
  end?: string;
}
