import type { AccessCriticality, AccessFlag, AccessStatus, Id, ISODateString } from "./enums";

/**
 * Access item / third-party connection (GBP, Meta Business Manager, POS back
 * office, website admin …) and its request/verification state. Backs the
 * onboarding "blockers" view. Maps to the workbook "Access" tab.
 * API_REFERENCE.md §9. `accessItem` is unique per merchant (409 on create AND
 * rename).
 */
export interface Connection {
  id: Id;
  merchantId: Id;
  accessItem: string;
  criticality: AccessCriticality;
  status: AccessStatus;
  flag: AccessFlag;
  owner: string | null;
  notes: string | null; // maps to the workbook's "why it matters" column
  dateRequested: ISODateString | null;
  dateReceived: ISODateString | null;
  /** Independent column — setting `status: "VERIFIED"` does NOT set this. */
  verified: boolean;
  verifiedDate: ISODateString | null;
  expiry: ISODateString | null; // for credentials that lapse
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** CreateConnectionDto — `accessItem` + `criticality` required. */
export interface CreateConnectionInput {
  accessItem: string;
  criticality: AccessCriticality;
  status?: AccessStatus; // default NOT_REQUESTED
  flag?: AccessFlag; // default OPEN
  owner?: string;
  notes?: string;
  dateRequested?: ISODateString;
  dateReceived?: ISODateString;
  verified?: boolean;
  verifiedDate?: ISODateString;
  expiry?: ISODateString;
}

/**
 * UpdateConnectionDto = Partial<Create>. Optional text/date fields may also be
 * sent as `null` to clear them (the DTO marks them `@IsOptional()`, which lets a
 * null through to be nulled); `accessItem`/`criticality` are never null.
 */
export type UpdateConnectionInput = {
  accessItem?: string;
  criticality?: AccessCriticality;
  status?: AccessStatus;
  flag?: AccessFlag;
  verified?: boolean;
  owner?: string | null;
  notes?: string | null;
  dateRequested?: ISODateString | null;
  dateReceived?: ISODateString | null;
  verifiedDate?: ISODateString | null;
  expiry?: ISODateString | null;
};
