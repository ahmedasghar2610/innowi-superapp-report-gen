/** Merchants → Payments (API: modules/merchant_profiling/payments_import.py). */

export type CheckLevel = "danger" | "warning" | "info";
export interface PaymentCheck {
  level: CheckLevel;
  title: string;
  text: string;
}

export interface PaymentMonth {
  id: string;
  /** First day of the month, YYYY-MM-01. */
  month: string;
  /** The account name as the revenue report writes it. */
  account: string;
  status: string | null;
  packageType: string | null;
  contract: number | null;
  charged: number | null;
  variance: number | null;
  ordersRevenue: number | null;
  commission: number | null;
  notes: string | null;
  sourceFile: string | null;
  sourceSheet: string | null;
  importedAt: string | null;
  /** Online-order revenue ÷ what was charged. */
  returnMultiple: number | null;
  /** Change in online-order revenue vs the month before (0.12 = +12 %). */
  ordersRevenueChange: number | null;
  checks: PaymentCheck[];
}

export interface MerchantPayments {
  profile: { merchantStatus: string | null; packageCode: string | null; subscriptionStatus: string | null; mrr: number | null; googleAdsBudget: number | null };
  latest: PaymentMonth | null;
  months: PaymentMonth[];
  totals: { months: number; contract: number; charged: number; variance: number; ordersRevenue: number };
}

export interface PaymentCandidate {
  merchantId: string;
  name: string;
  code: string | null;
  score: number;
  reason: string;
}

export interface PaymentImportRow {
  key: string;
  row: number;
  account: string;
  status: string | null;
  packageType: string | null;
  contract: number | null;
  charged: number | null;
  variance: number | null;
  ordersRevenue: number | null;
  commission: number | null;
  notes: string | null;
  candidates: PaymentCandidate[];
  /** The merchant the importer would pick by itself (null = none good enough). */
  suggested: string | null;
  sure: boolean;
  /** The merchant this row will be saved on (after the person's choices). */
  merchantId: string | null;
  /** This merchant already has this month — importing replaces it. */
  replaces: boolean;
  /** Another row already goes to the same merchant; this one is left out. */
  duplicateOf?: string;
}

export interface PaymentsImport {
  sheets: { name: string; month: string | null; rows: number }[];
  sheet: string;
  month: string | null;
  columns: Record<string, string>;
  merchants: { merchantId: string; name: string; code: string | null }[];
  totals: { rows: number; matched: number; sure: number; unmatched: number; replaces: number; contract: number; charged: number; variance: number; ordersRevenue: number };
  rows: PaymentImportRow[];
  applied?: { written: number; month: string };
}
