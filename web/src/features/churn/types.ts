/** Churned accounts — mirrors api/app/schemas/churn.py. */

export const WINBACK_STATUSES = ["NOT_STARTED", "CONTACTED", "IN_TALKS", "WON_BACK", "DECLINED", "CLOSED_PERMANENTLY"] as const;
export type WinbackStatus = (typeof WINBACK_STATUSES)[number];

export const MERCHANT_STATUSES = ["PROSPECT", "ONBOARDING", "ACTIVE", "PAUSED", "CHURNED"] as const;
export type MerchantStatus = (typeof MERCHANT_STATUSES)[number];

export interface PersonRef {
  id: string;
  name: string;
  email: string;
}

export interface ChurnContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface ChurnLocation {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface ChurnNote {
  id: string;
  body: string;
  author: PersonRef | null;
  createdAt: string;
}

export interface ChurnRow {
  merchantId: string;
  churnId: string;
  restaurantName: string;
  merchantCode: string | null;
  merchantStatus: MerchantStatus;
  region: string | null;
  innowiSolution: string | null;
  accountTier: number | null;
  accountManager: string | null;
  churnedOn: string | null;
  category: string | null;
  categories: string[];
  reason: string | null;
  csmName: string | null;
  mrrAtChurn: string | null;
  gpvAtChurn: string | null;
  startDate: string | null;
  lastTouchpointOn: string | null;
  source: string | null;
  winbackStatus: WinbackStatus;
  winbackOwner: PersonRef | null;
  winbackNotes: string | null;
  nextFollowUpOn: string | null;
  contact: ChurnContact | null;
  location: ChurnLocation | null;
  notesCount: number;
  updatedAt: string;
}

export interface ChurnDetail extends ChurnRow {
  notes: ChurnNote[];
  contacts: ChurnContact[];
}

export interface ChurnQuery {
  page?: number;
  limit?: number;
  search?: string;
  region?: string;
  category?: string;
  csm?: string;
  winbackStatus?: WinbackStatus;
  ownerId?: string;
  mine?: boolean;
  churnedFrom?: string;
  churnedTo?: string;
  hasReason?: boolean;
  sortBy?: "churnedOn" | "restaurantName" | "mrrAtChurn" | "gpvAtChurn" | "updatedAt" | "nextFollowUpOn";
  order?: "asc" | "desc";
}

export interface CountRow {
  key: string;
  count: number;
  mrr: string;
  gpv: string;
}

export interface ChurnSummary {
  total: number;
  withReason: number;
  mrrLost: string;
  gpvLost: string;
  byRegion: CountRow[];
  byCategory: CountRow[];
  byWinback: CountRow[];
  byCsm: CountRow[];
  bySolution: CountRow[];
  byMonth: CountRow[];
  regions: string[];
  categories: string[];
  csms: string[];
  owners: PersonRef[];
}

export interface UpdateChurnInput {
  winbackStatus?: WinbackStatus;
  winbackOwnerId?: string;
  clearWinbackOwner?: boolean;
  winbackNotes?: string;
  nextFollowUpOn?: string;
  clearNextFollowUp?: boolean;
  churnedOn?: string;
  category?: string;
  reason?: string;
  csmName?: string;
  mrrAtChurn?: string;
  gpvAtChurn?: string;
}

export interface MarkChurnedInput {
  churnedOn?: string;
  category?: string;
  reason?: string;
  csmName?: string;
  mrrAtChurn?: string;
  gpvAtChurn?: string;
}

export interface ImportSheet {
  name: string;
  layout: "contacts" | "reasons" | "unknown";
  rows: number;
  skipped: number;
}

export interface ChurnImportReport {
  fileName: string;
  dryRun: boolean;
  sheets: ImportSheet[];
  rowsRead: number;
  merchantsCreated: number;
  merchantsMatched: number;
  contactsAdded: number;
  locationsAdded: number;
  churnRecordsCreated: number;
  churnRecordsUpdated: number;
  duplicatesInFile: number;
  ambiguous: { sheet: string; row: number; name: string; matched: string; candidates: number }[];
  skipped: { sheet: string; row: number; reason: string }[];
}
