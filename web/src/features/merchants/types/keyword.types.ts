import type { Id, ISODateString, KeywordType } from "./enums";

/**
 * Search keyword — one row per term from the workbook's "Primary / Secondary /
 * Location Keywords" columns. Defined here once; SEO and Ads read it.
 * (merchant, term, type) is unique — a duplicate POST returns 409.
 */
export interface Keyword {
  id: Id;
  merchantId: Id;
  term: string;
  type: KeywordType;
  createdAt: ISODateString;
}

export interface CreateKeywordInput {
  term: string; // ≤ 200
  type: KeywordType;
}

export type UpdateKeywordInput = Partial<CreateKeywordInput>;
