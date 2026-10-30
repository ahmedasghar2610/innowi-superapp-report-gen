/** Quote builder (API: app/modules/quotes). Money arrives as decimal strings ("24.95"). */

export type QuoteMode = "SHOW_PRICES" | "HIDE_PRICES";
export type HardwarePlan = "BUY" | "LEASE";
export type ItemKind = "DEVICE" | "HARDWARE" | "SOFTWARE" | "SERVICE";
export type RequestStatus = "REQUESTED" | "PROPOSED" | "ACCEPTED" | "SIGNED" | "EXECUTED" | "DECLINED" | "CLOSED";
export type SignMethod = "DRAWN" | "TYPED";
export type Money = string;

export interface PriceItem {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  note?: string | null;
  section: string;
  kind: ItemKind;
  unitLabel?: string | null;
  monthlyPrice?: Money | null;
  purchasePrice?: Money | null;
  leasePrice?: Money | null;
  isStation: boolean;
  bundledInSku?: string | null;
  selectable: boolean;
  maxQty: number;
  sortOrder: number;
  active: boolean;
  updatedAt: string;
}

export interface PriceItemUpdate {
  name?: string;
  description?: string | null;
  note?: string | null;
  monthlyPrice?: Money | null;
  purchasePrice?: Money | null;
  leasePrice?: Money | null;
  maxQty?: number;
  active?: boolean;
  bundledInSku?: string;
  clear?: ("monthlyPrice" | "purchasePrice" | "leasePrice" | "note" | "description" | "unitLabel" | "bundledInSku")[];
}

export interface Section {
  key: string;
  title: string;
  blurb?: string | null;
}

export interface LinkItem {
  itemId: string;
  percentOff?: Money | null;
  monthlyPrice?: Money | null;
  purchasePrice?: Money | null;
  leasePrice?: Money | null;
  hidden?: boolean;
}

export interface RequestBrief {
  id: string;
  number: string;
  status: RequestStatus;
  createdAt: string;
  oneTimeTotal: Money;
  monthlyTotal: Money;
}

export interface QuoteLink {
  id: string;
  mode: QuoteMode;
  status: "ACTIVE" | "REVOKED";
  restaurantName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  merchantId?: string | null;
  dealId?: string | null;
  message?: string | null;
  discountPercent: Money;
  allowLease: boolean;
  expiresAt?: string | null;
  expired: boolean;
  createdByEmail: string;
  createdAt: string;
  lastOpenedAt?: string | null;
  openCount: number;
  requestCount: number;
  latestRequest?: RequestBrief | null;
  items: LinkItem[];
}

export interface LinkCreated {
  link: QuoteLink;
  url: string;
}

export interface CreateLinkInput {
  mode: QuoteMode;
  restaurantName: string;
  /** The deal this quote belongs to (features/deals). The link is attached and the deal gets a QUOTE_LINKED event. */
  dealId?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  message?: string;
  discountPercent?: string;
  allowLease?: boolean;
  expiresInDays?: number;
  items?: LinkItem[];
}

export type UpdateLinkInput = Partial<Omit<CreateLinkInput, "mode">>;

export interface Line {
  sku: string;
  name: string;
  section: string;
  category: "hardware" | "lease" | "software" | "service";
  billing: "ONE_TIME" | "MONTHLY";
  qty: number;
  unitList?: Money | null;
  unitPrice?: Money | null;
  total?: Money | null;
  listTotal?: Money | null;
  detail?: string | null;
  unitLabel?: string | null;
}

export interface Totals {
  oneTime: Money;
  monthlySoftware: Money;
  monthlyLease: Money;
  monthly: Money;
  listOneTime: Money;
  listMonthly: Money;
  savingsOneTime: Money;
  savingsMonthly: Money;
}

export interface Priced {
  lines: Line[];
  totals: Totals;
  /** Names of items dropped because a selected bundle already includes them. */
  bundledOut?: string[];
}

export interface Revision {
  revNo: number;
  authorKind: "STAFF" | "RESTAURANT";
  authorName?: string | null;
  authorEmail?: string | null;
  note?: string | null;
  hardwarePlan: HardwarePlan;
  lines: Line[];
  totals: Totals;
  contentHash: string;
  createdAt: string;
}

export interface PublicRevision {
  revNo: number;
  authorKind: "STAFF" | "RESTAURANT";
  note?: string | null;
  hardwarePlan: HardwarePlan;
  lines: Line[];
  totals?: Totals | null;
  createdAt: string;
}

export interface Signature {
  revNo: number;
  role: "CLIENT" | "INNOWI";
  name: string;
  title?: string | null;
  email?: string | null;
  method: SignMethod;
  signatureData: string;
  consentVersion?: string;
  contentHash?: string;
  voidedAt?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  signedAt: string;
}

export interface PublicSignature {
  revNo: number;
  role: "CLIENT" | "INNOWI";
  name: string;
  title?: string | null;
  method: SignMethod;
  signatureData: string;
  voidedAt?: string | null;
  signedAt: string;
}

export interface QuoteEvent {
  revNo?: number | null;
  kind: string;
  actor?: string | null;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
  createdAt: string;
}

export interface SignInput {
  revisionNo: number;
  name: string;
  title?: string;
  method: SignMethod;
  signatureData: string;
  agree: true;
}

export interface Selection {
  itemId: string;
  qty: number;
}

export interface QuoteRequest {
  id: string;
  number: string;
  status: RequestStatus;
  mode: QuoteMode;
  linkId: string;
  restaurantName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  notes?: string | null;
  hardwarePlan: HardwarePlan;
  lines: Line[];
  totals: Totals;
  createdAt: string;
  currentRevisionNo: number;
  pricesRevealed: boolean;
  declinedReason?: string | null;
  revisions: Revision[];
  signatures: Signature[];
  events: QuoteEvent[];
  acceptedAt?: string | null;
  acceptedName?: string | null;
  acceptedTitle?: string | null;
  staffNote?: string | null;
  notified: Record<string, { teams?: boolean | null; email?: boolean | null; clientEmail?: boolean | null }>;
  linkCreatedByEmail?: string | null;
}

export interface QuoteSummary {
  activeLinks: number;
  requestsOpen: number;
  accepted30d: number;
  acceptedMonthly30d: Money;
}

// ── Public (restaurant) ──
export interface PublicItem {
  id: string;
  sku: string;
  name: string;
  description?: string;
  note?: string;
  kind: ItemKind;
  unitLabel?: string;
  isStation: boolean;
  maxQty: number;
  bundledInSku?: string;
  bundledInName?: string;
  listMonthly?: Money;
  listPurchase?: Money;
  listLease?: Money;
  monthly?: Money;
  purchase?: Money;
  lease?: Money;
}

export interface PublicOffer {
  restaurantName: string;
  contactName?: string;
  message?: string;
  showPrices: boolean;
  allowLease: boolean;
  leaseMonths: number;
  firstStationMonthly?: Money;
  sections: { key: string; title: string; blurb?: string; items: PublicItem[] }[];
  goldIncluded: string[];
  terms: string[];
  preparedBy?: string;
  latestRequest?: { id: string; number: string; status: RequestStatus; createdAt: string };
}

export interface PublicRequest {
  id: string;
  number: string;
  status: RequestStatus;
  showPrices: boolean;
  createdAt: string;
  restaurantName: string;
  contactName: string;
  contactEmail: string;
  hardwarePlan: HardwarePlan;
  notes?: string;
  lines: Line[];
  totals?: Totals;
  currentRevisionNo: number;
  revisions: PublicRevision[];
  signatures: PublicSignature[];
  consentText?: string;
  consentVersion?: string;
  declinedReason?: string | null;
  acceptedAt?: string;
  acceptedName?: string;
  terms: string[];
  goldIncluded: string[];
  leaseMonths: number;
}
