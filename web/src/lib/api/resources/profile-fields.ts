import { api } from "../client";
import type {
  AttestFieldInput,
  MerchantProfile,
  ProfileField,
  ProfileFieldsResponse,
  UpdateProfileFieldInput,
} from "@/features/merchants/types";

/* Server-driven profile fields. API_REFERENCE.md §4.
   Types live in @/features/merchants/types; re-exported here for convenience. */
export type {
  ProfileField,
  ProfileFieldType,
  ProfileFieldGroup,
  ProfileFieldsResponse,
  VerificationConfidence,
  MerchantProfile,
  UpdateProfileFieldInput,
} from "@/features/merchants/types";

export const profileFields = {
  /** GET /merchants/:id/profile → merchant + all 20 fields + completion summary. */
  getProfile(merchantId: string): Promise<MerchantProfile> {
    return api.get<MerchantProfile>(`/merchants/${merchantId}/profile`);
  },

  /**
   * GET /merchants/:id/fields → the flat field list (registry order) + a
   * completion summary. Uses `api.get` (not `getList`) because the response
   * carries `completion` alongside `data`, which `getList`'s envelope-unwrap
   * would otherwise discard.
   */
  list(merchantId: string): Promise<ProfileFieldsResponse> {
    return api.get<ProfileFieldsResponse>(`/merchants/${merchantId}/fields`);
  },

  /** PATCH /merchants/:id/fields/:key → the single updated field. */
  update(merchantId: string, key: string, input: UpdateProfileFieldInput): Promise<ProfileField> {
    return api.patch<ProfileField>(`/merchants/${merchantId}/fields/${key}`, input);
  },

  /** POST /merchants/:id/fields/:key/attest → the field with its new attestation (value untouched). */
  attest(merchantId: string, key: string, input: AttestFieldInput): Promise<ProfileField> {
    return api.post<ProfileField>(`/merchants/${merchantId}/fields/${key}/attest`, input);
  },
};
