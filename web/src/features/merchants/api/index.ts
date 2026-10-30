/**
 * Merchant Profiling — TanStack Query hooks over the API resource layer.
 * Import from "@/features/merchants/api".
 *
 * Every hook types its error as `ApiError`, derives its key from
 * `@/lib/query/query-keys`, and (for mutations) invalidates the affected caches
 * on success while forwarding any caller-supplied callbacks.
 */
export {
  useMerchants,
  useMerchant,
  useCreateMerchant,
  useUpdateMerchant,
  useDeleteMerchant,
} from "./merchants.queries";

export { useMerchantProfile, useProfileFields, useUpdateProfileField, useAttestField } from "./profile.queries";

export { useProfileCompleteness, useProfileAlerts } from "./completeness.queries";

export { useContacts, useCreateContact, useUpdateContact, useDeleteContact } from "./contacts.queries";

export { useLocations, useCreateLocation, useUpdateLocation, useDeleteLocation } from "./locations.queries";

export {
  useServices,
  useActivateService,
  useUpdateService,
  useDeactivateService,
} from "./services.queries";

export { useServiceCatalog } from "./service-catalog.queries";

export { useDocuments, useCreateDocument, useUpdateDocument, useDeleteDocument, useUploadDocument } from "./documents.queries";

export { useBrandAssets, useUploadBrandAsset, useUpdateBrandAsset, useDeleteBrandAsset } from "./brand-assets.queries";

export { usePromotions, useCreatePromotion, useUpdatePromotion, useDeletePromotion } from "./promotions.queries";

export {
  useConnections,
  useCreateConnection,
  useUpdateConnection,
  useDeleteConnection,
} from "./connections.queries";

export { useKeywords, useCreateKeyword, useUpdateKeyword, useDeleteKeyword } from "./keywords.queries";

export {
  useCompetitors,
  useCreateCompetitor,
  useUpdateCompetitor,
  useDeleteCompetitor,
} from "./competitors.queries";

export { useBrandProfile, useUpsertBrandProfile } from "./brand-profile.queries";

export { useCateringProfile, useUpsertCateringProfile } from "./catering-profile.queries";

export { useAccountManagers, useCreateAccountManager, useUpdateAccountManager } from "./account-managers.queries";

export { useUpsertSubscription } from "./subscription.queries";

export { useDataQuality } from "./data-quality.queries";

export { useMerchantMenu, useExtractMenu } from "./menu.queries";

export { useImportMerchants, useMenuStatuses, useCheckMenus, useFetchMenus, usePickMenuLink } from "./import.queries";

export {
  useMerchantLinks, useLinkSearch, useLinkRecord, useUnlinkRecord, useConnectMerchants, describeConnect,
  type LinkModule, type LinkedRecord, type LinkSuggestion, type MerchantLinks, type ModuleLinks,
} from "./module-links.queries";
