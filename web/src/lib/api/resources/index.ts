/**
 * API resource layer — one module per backend controller (API_REFERENCE.md).
 * Each exports a namespaced object of typed functions plus its DTO/response
 * types. Import a resource: `import { merchants } from "@/lib/api/resources"`.
 */
export { merchants } from "./merchants";
export type {
  Merchant,
  AccountHealth,
  CreateMerchantInput,
  UpdateMerchantInput,
  MerchantListQuery,
} from "./merchants";

export { completeness } from "./completeness";
export type {
  ProfileCompleteness,
  CompletenessSection,
  MissingItem,
  PendingConnection,
  ConfidenceBreakdown,
  ProfileAlert,
  ProfileAlertSeverity,
  ProfileAlertType,
} from "./completeness";

export { profileFields } from "./profile-fields";
export type {
  ProfileField,
  ProfileFieldType,
  VerificationConfidence,
  MerchantProfile,
  UpdateProfileFieldInput,
} from "./profile-fields";

export { contacts } from "./contacts";
export type {
  Contact,
  ContactRole,
  PreferredChannel,
  Responsiveness,
  CreateContactInput,
  UpdateContactInput,
} from "./contacts";

export { locations } from "./locations";
export type { Location, CreateLocationInput, UpdateLocationInput } from "./locations";

export { services } from "./services";
export type {
  MerchantService,
  MerchantServiceStatus,
  ServiceCategory,
  CreateMerchantServiceInput,
  UpdateMerchantServiceInput,
} from "./services";

export { documents } from "./documents";
export type {
  Document,
  DocumentCategory,
  DocumentStatus,
  CreateDocumentInput,
  UpdateDocumentInput,
  UploadDocumentInput,
} from "./documents";

export { brandAssets } from "./brand-assets";
export type {
  BrandAsset,
  BrandAssetType,
  BrandAssetStatus,
  UploadBrandAssetInput,
  UpdateBrandAssetInput,
} from "./brand-assets";

export { promotions } from "./promotions";
export type { Promotion, PromotionStatus, CreatePromotionInput, UpdatePromotionInput } from "./promotions";

export { connections } from "./connections";
export type {
  Connection,
  AccessCriticality,
  AccessStatus,
  AccessFlag,
  CreateConnectionInput,
  UpdateConnectionInput,
} from "./connections";

export { keywords } from "./keywords";
export type { Keyword, KeywordType, CreateKeywordInput, UpdateKeywordInput } from "./keywords";

export { competitors } from "./competitors";
export type { Competitor, CreateCompetitorInput, UpdateCompetitorInput } from "./competitors";

export { brandProfile } from "./brand-profile";
export type { BrandProfile, UpsertBrandProfileInput } from "./brand-profile";

export { cateringProfile } from "./catering-profile";
export type { CateringProfile, UpsertCateringProfileInput } from "./catering-profile";

export { accountManagers } from "./account-managers";
export type {
  AccountManager,
  MerchantAccountManager,
  CreateAccountManagerInput,
  UpdateAccountManagerInput,
} from "./account-managers";

export { subscription } from "./subscription";
export type { UpsertSubscriptionInput } from "./subscription";

export { dataQuality } from "./data-quality";
export type { DataQualityResponse, DataQualityMerchant, CompletenessBand } from "./data-quality";

export { catalog } from "./catalog";
export type {
  CatalogPackage,
  CatalogService,
  CatalogEntitlement,
  CatalogEntitlementQuery,
  CatalogServiceQuery,
} from "./catalog";

export { audit } from "./audit";
export type {
  AuditLog,
  AuditAction,
  AuditOutcome,
  AuditLogQuery,
  MerchantHistoryQuery,
} from "./audit";

export { menu } from "./menu";
