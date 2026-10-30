/* Merchants → Import from XLS / CSV and menus across merchants.
   API: app/modules/merchant_profiling/merchant_import.py, routers/merchant_import.py, routers/menu_bulk.py */

export type ImportFieldStatus = "new" | "fill" | "conflict";
export type ImportRowAction = "create" | "update" | "unchanged" | "skip";
export type MenuStatusKind = "fetched" | "running" | "queued" | "failed" | "ready" | "pick" | "none";

export interface ImportField {
  /** "merchant.legal_name", "contact:OWNER.email", ... */
  key: string;
  /** The sheet's column name. */
  label: string;
  group: string;
  current: string | null;
  incoming: string | null;
  status: ImportFieldStatus;
  /** After an import: whether the sheet value was written. */
  applied?: boolean;
}

export interface ImportAdd {
  key: string;
  label: string;
  value: string;
  rank?: number;
}

export interface ImportRow {
  row: number;
  /** Merchant ID, or "row<N>" — the key decisions refer to. */
  key: string;
  merchantCode: string | null;
  restaurantName: string | null;
  merchantId: string | null;
  action: ImportRowAction;
  reason: string | null;
  fields: ImportField[];
  adds: ImportAdd[];
  sameCount: number;
  warnings: string[];
  menu: { status: "ready" | "pick" | "none"; links: string[] } | null;
}

export interface ImportReport {
  sheet: string | null;
  unknownColumns: string[];
  totals: { rows: number; create: number; update: number; unchanged: number; skip: number; conflicts: number; fills: number; adds: number };
  rows: ImportRow[];
  applied?: {
    created: number;
    updated: number;
    fieldsWritten: number;
    conflictsKept: number;
    conflictsReplaced: number;
    added: number;
    merchantIds: string[];
  };
  /** The workbook's Access (→ Connections) and Delivery (→ Services) sheets. */
  otherSheets?: OtherSheetImport[];
  /** The workbook's Promotions sheet (null when the file has none). */
  promotions?: PromotionsImport | null;
  /** The connector linked these merchants' SEO sites / Ads accounts right after the import. */
  connected?: { skipped: boolean; summary: Record<string, number> };
}

export interface ImportDecisions {
  /** "<row key>::<field key>" — conflicts that take the sheet value. */
  useSheet: string[];
  /** Row keys whose every conflict takes the sheet value. */
  useSheetAll: string[];
}

export interface MenuStatusRow {
  merchantId: string;
  restaurantName: string;
  merchantCode: string | null;
  status: MenuStatusKind;
  /** The link the menu is fetched from (null: none, or several to pick from). */
  link: string | null;
  /** Every Innowi link found in the merchant's Online ordering text. */
  links: string[];
  validCount: number | null;
  extractedAt: string | null;
  error: string | null;
  progress: { phase: string; done: number; total: number } | null;
  /** Only on a /check answer. */
  check?: "ok" | "failed" | "no-link";
  checkError?: string | null;
}

export interface MenuFetchResult {
  started: string[];
  skipped: Record<string, string>;
  remaining: string[];
}

export interface PromotionImportRow {
  row: number;
  merchantCode: string | null;
  restaurantName: string | null;
  merchantId: string | null;
  merchantName: string | null;
  promoName: string | null;
  offerType: string | null;
  offerValue: string | null;
  promoCode: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  /** new = added on import · exists = already on the merchant · noMerchant = can't be matched */
  /** none = the sheet says "No Promotion" for this merchant (shown, nothing added) */
  action: "new" | "exists" | "noMerchant" | "none";
  note: string | null;
}

export interface PromotionsImport {
  sheet: string | null;
  columns: Record<string, string>;
  totals: { rows: number; new: number; exists: number; noMerchant: number; none: number };
  rows: PromotionImportRow[];
  applied?: { created: number };
}

export interface OtherSheetImport {
  kind: "access" | "delivery";
  sheet: string;
  label: string;
  screen: string;
  rows: number;
  new: number;
  exists: number;
  noMerchant: number;
  skipped: number;
  unknown: string[];
  added: number;
}
