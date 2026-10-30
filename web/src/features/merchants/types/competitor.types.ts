import type { Id, ISODateString } from "./enums";

/**
 * Named local competitor — the workbook's "Competitor 1..3" columns. `rank`
 * is the column order (1 = primary); null for competitors added in-product
 * without one. The API sorts ranked first, then by insertion.
 */
export interface Competitor {
  id: Id;
  merchantId: Id;
  name: string;
  rank: number | null;
  createdAt: ISODateString;
}

export interface CreateCompetitorInput {
  name: string; // ≤ 200
  rank?: number; // 1..99
}

export type UpdateCompetitorInput = {
  name?: string;
  rank?: number | null;
};
