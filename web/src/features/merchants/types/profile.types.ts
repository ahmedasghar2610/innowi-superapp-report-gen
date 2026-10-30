import type { ISODateString, ProfileFieldType, VerificationConfidence } from "./enums";
import type { Merchant } from "./merchant.types";
import type { ProfileCompleteness } from "./completeness.types";

/**
 * The registry groups fields into sections for display (PRD §6.2): Restaurant
 * Information, Business & Service, Digital Profiles, Marketing, and an
 * Internal / Ops bucket for account-management fields the PRD doesn't assign
 * to a customer-facing group. Mirrors the backend's ProfileFieldGroup exactly.
 */
export type ProfileFieldGroup =
  | "Restaurant Information"
  | "Business & Service"
  | "Digital Profiles"
  | "Marketing"
  | "Internal / Ops";

/**
 * Server-driven profile field. The 20-field registry (keys, labels, types, enum
 * options) is delivered by the backend, so the form renders whatever comes back
 * and needs no change when a field is added. The `value` lives on the Merchant
 * row; the verification metadata is merged in from FieldVerification.
 * API_REFERENCE.md §4.
 */
export interface ProfileField {
  key: string;
  label: string;
  type: ProfileFieldType;
  group: ProfileFieldGroup;
  required: boolean;
  /** string | boolean | null; dates are ISO strings, decimals are decimal strings, everything else stringified. */
  value: string | boolean | null;
  /** Present only on `type: "enum"` fields. */
  options?: string[];
  /**
   * Short editorial note to render beneath the field, server-driven. Today it
   * marks the master budget fields (googleAdsBudget / metaAdsBudget) whose
   * ownership the Ads modules must respect (PRD Appendix C-6 / ADS-02).
   */
  note?: string;
  source: string | null;
  confidence: VerificationConfidence;
  verifiedBy: string | null;
  verifiedAt: ISODateString | null;
  /** Derived: confidence !== "UNVERIFIED" AND verifiedAt is set. */
  verified: boolean;
}

/**
 * GET /merchants/:id/fields payload — the flat field list plus the completeness
 * summary. `completion` covers every section (files, contacts, locations,
 * connections), not just these fields, so the Profile tab can render its
 * missing-item lists without a second request. Same object as
 * `GET /merchants/:id/completeness`.
 */
export interface ProfileFieldsResponse {
  data: ProfileField[];
  completion: ProfileCompleteness;
}

/** GET /merchants/:id/profile payload — merchant record + all fields + completeness. */
export interface MerchantProfile {
  merchant: Merchant;
  fields: ProfileField[];
  completion: ProfileCompleteness;
}

/**
 * UpdateProfileFieldDto (API §4.5). `value` is required and must match the
 * field's declared `type`:
 *   string  → a string (required fields reject "")
 *   url     → a string that parses as a URL incl. protocol
 *   boolean → JSON true / false (not the strings "true"/"false")
 *   date    → an ISO-8601 string
 *   enum    → one of the field's `options`
 *   decimal → a non-negative JSON number (e.g. googleAdsBudget/metaAdsBudget)
 * `verifiedAt` is stamped by the server, never sent by the client.
 */
export interface UpdateProfileFieldInput {
  value: string | boolean | number;
  source?: string;
  /** Omitted → the new value lands as UNVERIFIED (a changed value carries no attestation). */
  confidence?: VerificationConfidence;
  verifiedBy?: string;
}

/**
 * POST /merchants/:id/fields/:key/attest — change the attestation WITHOUT
 * changing the value (Verify · Mark outdated · Mark placeholder · back to
 * Unverified). `verifiedBy` is the signed-in user, set server-side.
 */
export interface AttestFieldInput {
  confidence: VerificationConfidence;
  source?: string;
}
