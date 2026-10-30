import type { Id, ISODateString } from "./enums";

/**
 * Account manager — the Innowi staff member who owns a merchant relationship
 * (workbook "Account Manager"). A flat reference list, not a per-merchant child.
 */
export interface AccountManager {
  id: Id;
  name: string;
  team: string | null;
  email: string | null;
  /** Merchants currently assigned to this manager. */
  merchantCount: number;
  createdAt: ISODateString;
}

/** The `{ id, name }` embedded on every Merchant response. */
export interface MerchantAccountManager {
  id: Id;
  name: string;
}

export interface CreateAccountManagerInput {
  name: string;
  team?: string;
  email?: string;
}

export type UpdateAccountManagerInput = {
  name?: string;
  team?: string | null;
  email?: string | null;
};
