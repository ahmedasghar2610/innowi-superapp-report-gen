/**
 * Merchant Profiling — centralized type layer (single source of truth).
 * Import from "@/features/merchants/types".
 *
 * Enum runtime values (const arrays) are exported as values; everything else is
 * a type-only export.
 */

// Enums — runtime const arrays + derived union types + shared aliases.
export {
  ACCOUNT_HEALTH,
  YES_NO,
  MERCHANT_SORT_BY,
  SORT_ORDER,
  CONTACT_ROLE,
  PREFERRED_CHANNEL,
  RESPONSIVENESS,
  KEYWORD_TYPE,
  MERCHANT_SERVICE_STATUS,
  SERVICE_CATEGORY,
  DOCUMENT_CATEGORY,
  DOCUMENT_STATUS,
  PROMOTION_STATUS,
  ACCESS_CRITICALITY,
  ACCESS_STATUS,
  ACCESS_FLAG,
  VERIFICATION_CONFIDENCE,
  PROFILE_FIELD_TYPE,
  MERCHANT_SUBSCRIPTION_STATUS,
  MERCHANT_ACCOUNT_STATUS,
} from "./enums";
export type {
  Id,
  ISODateString,
  AccountHealth,
  YesNo,
  MerchantSortBy,
  SortOrder,
  ContactRole,
  PreferredChannel,
  Responsiveness,
  KeywordType,
  MerchantServiceStatus,
  ServiceCategory,
  DocumentCategory,
  DocumentStatus,
  PromotionStatus,
  AccessCriticality,
  AccessStatus,
  AccessFlag,
  VerificationConfidence,
  ProfileFieldType,
  MerchantSubscriptionStatus,
  MerchantAccountStatus,
} from "./enums";

export type {
  Merchant,
  MerchantPackage,
  MerchantSubscription,
  CreateMerchantInput,
  UpdateMerchantInput,
  MerchantListQuery,
} from "./merchant.types";
export type { Contact, CreateContactInput, UpdateContactInput } from "./contact.types";
export type { Location, CreateLocationInput, UpdateLocationInput } from "./location.types";
export type {
  MerchantService,
  CreateMerchantServiceInput,
  UpdateMerchantServiceInput,
} from "./service.types";
export type { Document, CreateDocumentInput, UpdateDocumentInput, UploadDocumentInput } from "./document.types";
export { BRAND_ASSET_TYPE, BRAND_ASSET_STATUS } from "./brand-asset.types";
export type {
  BrandAsset,
  BrandAssetType,
  BrandAssetStatus,
  UploadBrandAssetInput,
  UpdateBrandAssetInput,
} from "./brand-asset.types";
export type { Promotion, CreatePromotionInput, UpdatePromotionInput } from "./promotion.types";
export type { Connection, CreateConnectionInput, UpdateConnectionInput } from "./connection.types";
export type { Keyword, CreateKeywordInput, UpdateKeywordInput } from "./keyword.types";
export type { Competitor, CreateCompetitorInput, UpdateCompetitorInput } from "./competitor.types";
export type { BrandProfile, UpsertBrandProfileInput } from "./brand-profile.types";
export type { CateringProfile, UpsertCateringProfileInput } from "./catering-profile.types";
export type {
  AccountManager,
  MerchantAccountManager,
  CreateAccountManagerInput,
  UpdateAccountManagerInput,
} from "./account-manager.types";
export type { UpsertSubscriptionInput } from "./subscription.types";
export { COMPLETENESS_BAND } from "./data-quality.types";
export type { CompletenessBand, DataQualityMerchant, DataQualityResponse } from "./data-quality.types";
export type {
  ProfileField,
  ProfileFieldGroup,
  ProfileFieldsResponse,
  MerchantProfile,
  UpdateProfileFieldInput,
  AttestFieldInput,
} from "./profile.types";

// Completeness & alerts (PROF-02/03 · §6.4) — derived server-side, read-only.
export { PROFILE_ALERT_TYPE, PROFILE_ALERT_SEVERITY } from "./completeness.types";
export type {
  ProfileCompleteness,
  CompletenessSection,
  CompletenessSectionKey,
  MissingItem,
  MissingItemArea,
  MissingItemSeverity,
  PendingConnection,
  ConfidenceBreakdown,
  AttestationFlag,
  ExpiredConnection,
  NapConflict,
  AlertEvidence,
  ProfileAlert,
  ProfileAlertType,
  ProfileAlertSeverity,
  ProfileAlertTargetTab,
  ProfileAlertsResponse,
} from "./completeness.types";

export type {
  MenuItem,
  MenuItemStatus,
  MenuStats,
  MenuSummary,
  MenuProgress,
  MerchantMenu,
  ExtractMenuInput,
} from "./menu.types";
export * from "./import.types";
