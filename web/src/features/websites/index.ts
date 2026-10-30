// Website module — public surface. Import from "@/features/websites".

export type {
  CreateWebsiteInput,
  UpdateWebsiteInput,
  Website,
  WebsiteField,
  WebsiteFormEntry,
  WebsiteFormStep,
  WebsiteGroup,
  WebsiteListMeta,
  WebsiteListQuery,
  WebsiteListResponse,
  WebsiteProgress,
  WebsiteRepeat,
  WebsiteRepeatRow,
  WebsiteStatus,
  WebsiteValues,
  WebsiteDocxImport,
  WebsiteAsset,
} from "./types";
export { WEBSITE_STATUS } from "./types";

export { WEBSITE_FORM_STEPS, WEBSITE_CONTENT_STEPS } from "./data/website-form-steps";
export { websitesApi, WEBSITES_API_BASE_URL } from "./api/client";
export {
  websiteKeys,
  useWebsites,
  useWebsite,
  useCreateWebsite,
  useUpdateWebsite,
  useDeleteWebsite,
} from "./api/websites.queries";
export { websiteProgress } from "./lib/website-values";

export { WebsitesPanel } from "./components/websites-panel";
export { WebsiteFormModal } from "./components/website-form-modal";
export { WebsiteImportDocxModal } from "./components/website-import-docx-modal";
export { WebsiteStatusBadge } from "./components/website-status-badge";
