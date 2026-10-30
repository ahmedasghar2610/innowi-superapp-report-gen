import type { AccountHealth, Id, ISODateString, MerchantSubscriptionStatus } from "./enums";

/**
 * GET /profiling/data-quality — the portfolio Data Quality view (Super App
 * PRD §22, M1-02). Every number is read from materialised columns and
 * aggregates on the server; nothing is recomputed per merchant, so this is
 * cheap to poll. `bands.unscored > 0` means the backfill has not been run.
 */

export const COMPLETENESS_BAND = ["COMPLETE", "PARTIAL", "CRITICAL", "UNSCORED"] as const;
export type CompletenessBand = (typeof COMPLETENESS_BAND)[number];

export interface DataQualityMerchant {
  id: Id;
  merchantCode: string | null;
  restaurantName: string;
  accountHealth: AccountHealth | null;
  accountManagerName: string | null;
  subscriptionStatus: MerchantSubscriptionStatus | null;
  profileCompletionPct: number | null;
  band: CompletenessBand;
  /** Pending blocking-criticality access items. */
  blockingConnections: number;
  updatedAt: ISODateString;
}

export interface DataQualityResponse {
  generatedAt: ISODateString;
  thresholds: { completeAtPct: number; criticalBelowPct: number };
  totals: { merchants: number; scored: number; averagePercent: number | null; medianPercent: number | null };
  bands: { complete: number; partial: number; critical: number; unscored: number };
  confidence: {
    confirmed: number;
    needsReview: number;
    unverified: number;
    outdated: number;
    placeholder: number;
    /** Registry fields with no verification row at all. */
    noAttestation: number;
    /** merchants × registry fields. */
    fieldSlots: number;
  };
  connections: { pending: number; blocking: number; merchantsWithBlockers: number };
  /** All merchants, worst completeness first (unscored first). */
  merchants: DataQualityMerchant[];
}
