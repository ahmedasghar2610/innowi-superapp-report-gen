import type {
  AccountHealth,
  Id,
  ISODateString,
  MerchantAccountStatus,
  MerchantSortBy,
  MerchantSubscriptionStatus,
  SortOrder,
  YesNo,
} from "./enums";
import type { MerchantAccountManager } from "./account-manager.types";

/**
 * Catalog package (Catalog API — `GET /packages`, `GET /packages/:code`).
 * `code` is the workbook's package identifier ("$199"/"$299"); `price` is a
 * decimal string as the API returns it, not a number.
 */
export interface MerchantPackage {
  code: string;
  name: string;
  price: string;
}

/**
 * The merchant's current subscription, embedded on every Merchant response
 * (`GET /merchants`, `GET /merchants/:id`, create/update). `null` when the
 * merchant has no subscription row yet — always check before rendering.
 */
export interface MerchantSubscription {
  package: MerchantPackage;
  status: MerchantSubscriptionStatus;
  startDate: ISODateString | null;
  renewalDate: ISODateString | null;
  mrr: string;
  isCurrent: boolean;
}

/**
 * Merchant identity record — the master row every module references
 * (Central PRD §5.2 source of truth). Columns map to the workbook "Merchants"
 * tab; the shape here is the API's MerchantResponseDto (API_REFERENCE.md §3.1),
 * where every optional field comes back as `null` (never absent).
 */
export interface Merchant {
  id: Id;
  restaurantName: string; // display name (DBA) — NOT unique
  /** Workbook "Merchant ID" (M-001). Unique when present; the cross-reference back to the sheet. */
  merchantCode: string | null;
  /** Account lifecycle (not the marketing package). CHURNED accounts live on /churn. */
  status: MerchantAccountStatus;
  /** Innowi territory: BA, LA, NY, … */
  region: string | null;
  /** What Innowi runs there: "Full Solution", "Kiosk Only", … */
  innowiSolution: string | null;
  accountTier: number | null;
  /** Where the record came from (features/sources/labels.ts); null = not recorded. Set by the API, never edited. */
  source: string | null;
  /** The file, website slug or deal behind it ("Churned Accounts 2024-26.xlsx / LA", "D-1001"). */
  sourceDetail: string | null;
  legalName: string | null;
  cuisineCategory: string | null;
  websiteUrl: string | null;
  websitePlatform: string | null;
  onlineOrdering: string | null;
  posSystem: string | null;
  customerListSource: string | null;
  /**
   * Master marketing budgets (PRD Appendix C-6 / PROF-01 §6.2.4). Decimal
   * strings as the API returns them ("300.00"), never numbers — format with
   * `formatUsd`. The Google Ads and Meta Ads modules consume these read-only
   * (ADS-02) and must never define budget fields of their own.
   */
  googleAdsBudget: string | null;
  metaAdsBudget: string | null;
  businessGoals: string | null;
  targetAudience: string | null;
  slowDayparts: string | null;
  seasonalPeaks: string | null;
  alcoholLicense: YesNo | null;
  dietaryCerts: string | null;
  /** Footprint as stated in the workbook ("Multi-Location?" / "# of Locations"). */
  locationCount: number | null;
  /** Reporting cadence ("Report Frequency" / "Report Recipients"). */
  reportFrequency: string | null;
  reportRecipients: string | null;
  accountHealth: AccountHealth | null;
  /**
   * Server-computed profile completion (PROF-02), a write-behind cache of
   * `GET /merchants/:id/completeness.percent` (API §4a.3). Refreshed on every
   * write that can move the score, so the directory can list and sort by it.
   * Still `null` for a merchant whose score has never been computed.
   */
  profileCompletionPct: number | null;
  nextAction: string | null;
  openBlockers: string | null;
  notes: string | null;
  onboardingDate: ISODateString | null;
  goLiveDate: ISODateString | null;
  accountManagerId: Id | null;
  /** Assigned account manager `{ id, name }`, or null. */
  accountManager: MerchantAccountManager | null;
  /** Package/billing snapshot; `null` if no subscription exists yet. */
  subscription: MerchantSubscription | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * CreateMerchantDto (API §3.1). `restaurantName` is the only required field;
 * `profileCompletionPct` is never accepted (server-computed). Send only these
 * keys — the API rejects unknown properties with a 400.
 */
export interface CreateMerchantInput {
  restaurantName: string;
  merchantCode?: string;
  legalName?: string;
  cuisineCategory?: string;
  websiteUrl?: string; // valid URL with protocol
  websitePlatform?: string;
  onlineOrdering?: string;
  posSystem?: string;
  customerListSource?: string;
  /** Non-negative numbers on the way in; decimal strings on the way back out. */
  googleAdsBudget?: number;
  metaAdsBudget?: number;
  businessGoals?: string;
  targetAudience?: string;
  slowDayparts?: string;
  seasonalPeaks?: string;
  alcoholLicense?: YesNo;
  dietaryCerts?: string;
  locationCount?: number;
  reportFrequency?: string;
  reportRecipients?: string;
  accountHealth?: AccountHealth;
  nextAction?: string;
  openBlockers?: string;
  notes?: string;
  onboardingDate?: ISODateString;
  goLiveDate?: ISODateString;
  accountManagerId?: Id;
}

/**
 * UpdateMerchantDto = Partial<Create> (API §3.3); same validation when a field
 * is present. A field may also be sent as `null` to clear it — the DTO marks
 * every optional field `@IsOptional()`, which skips validation for null and lets
 * the value through to be nulled. `restaurantName` is required and never null.
 */
export type UpdateMerchantInput = {
  restaurantName?: string;
} & {
  [K in Exclude<keyof CreateMerchantInput, "restaurantName">]?: CreateMerchantInput[K] | null;
};

/**
 * Query for GET /merchants (API §3.2). All filters combine with AND; omitted
 * filters are ignored. `search` is a case-insensitive contains on
 * `restaurantName` or `merchantCode`.
 */
export interface MerchantListQuery {
  page?: number; // ≥ 1, default 1
  limit?: number; // 1–100, default 25
  order?: SortOrder;
  sortBy?: MerchantSortBy;
  search?: string;
  accountHealth?: AccountHealth;
  accountManagerId?: Id;
  cuisineCategory?: string;
  /** Current subscription status (workbook "Package Status"). */
  subscriptionStatus?: MerchantSubscriptionStatus;
  packageCode?: string;
  /** Account lifecycle. Omitted → everything except CHURNED; "ALL" → everything. */
  status?: MerchantAccountStatus | "ALL";
  region?: string;
  /** A source key, or "NONE" for records with none recorded. */
  source?: string;
}
