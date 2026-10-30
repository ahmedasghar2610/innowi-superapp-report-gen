/**
 * Website module — types.
 *
 * The "website details" intake questionnaire (the standalone `website-form`
 * prototype) rebuilt inside the Super App. One record per website; the answers
 * live under `values` as a nested object keyed by the dotted paths declared in
 * `data/website-form-steps.ts`.
 *
 * Answers are stored by the Super App API under `/api/v1/websites` (formerly a
 * standalone `website-api` service on :8000, now merged in), and the public
 * site template reads the same record back by `slug` to render the live page.
 */

/* ------------------------------------------------------------------ answers */

/** A nested answer tree. Leaves are strings; repeatable sections are arrays. */
export type WebsiteValues = Record<string, unknown>;

/** One row of a repeatable section (e.g. a menu item, a review). */
export type WebsiteRepeatRow = Record<string, string>;

/* --------------------------------------------------------------- form schema */

export type WebsiteFieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "textarea"
  | "color"
  | "image"
  | "select"
  /** Google Font picker (stores the family name). */
  | "font"
  /** Emoji picker (stores the emoji). */
  | "emoji"
  /** "·"-separated list as toggle chips (stores "A · B · C"). */
  | "chips"
  /** Free text with a suggestion list. */
  | "suggest";

export interface WebsiteField {
  kind: "field";
  /** Dotted path into `WebsiteValues`, e.g. `business.name`. */
  key: string;
  label: string;
  type: WebsiteFieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** Span both columns of the two-column grid. */
  fullWidth?: boolean;
  /** Options for `type: "select"`; toggles for `type: "chips"`; suggestions for `type: "suggest"`. */
  options?: string[];
  /** Seeded the first time the form is opened (colour swatches, selects). */
  defaultValue?: string;
}

/** A labelled divider between related fields inside one step. */
export interface WebsiteGroup {
  kind: "group";
  label: string;
}

/** A repeatable block of fields — menu items, selling points, reviews. */
export interface WebsiteRepeat {
  kind: "repeat";
  /** Dotted path to the array in `WebsiteValues`. */
  key: string;
  /** Singular noun used in the row heading ("Item 1", "Review 2"). */
  itemLabel: string;
  /** Rows that can never be removed. */
  min: number;
  addLabel: string;
  /** Sub-fields; their `key` is relative to the row. */
  fields: WebsiteField[];
}

export type WebsiteFormEntry = WebsiteField | WebsiteGroup | WebsiteRepeat;

export interface WebsiteFormStep {
  id: string;
  /** Short label shown under the stepper dot. */
  label: string;
  title: string;
  description: string;
  /** The final summary step renders the review table instead of fields. */
  review?: boolean;
  entries: WebsiteFormEntry[];
}

/* ------------------------------------------------------------------- record */

/** Website lifecycle — Central PRD WEB-06, in workflow order. */
export const WEBSITE_STATUS = [
  "not_started",
  "in_creation",
  "content_required",
  "content_map_required",
  "under_review",
  "live",
  "update_required",
  "inactive",
] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUS)[number];

/** Only these are visible to the public at the site's URL. */
export const PUBLIC_STATUSES: readonly WebsiteStatus[] = ["live", "update_required"];
export const isPublicStatus = (s: WebsiteStatus) => PUBLIC_STATUSES.includes(s);

export interface Website {
  id: string;
  /** URL key the site template serves this website at (`/<slug>`). */
  slug: string;
  /** Derived server-side from `values.business.name`; flat so the list can sort on it. */
  name: string;
  tagline: string;
  contactEmail: string;
  status: WebsiteStatus;
  values: WebsiteValues;
  /** Free-text working notes; not part of the questionnaire. */
  notes: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  /** The site's /admin visual editor has a password (editing is on). */
  hasAdminPassword?: boolean;
  /**
   * Set once the site has been edited in /<slug>/admin. The site template then
   * serves those edited pages instead of building the page from `values`, so
   * form changes don't show until "Rebuild from form".
   */
  editorUpdatedAt?: string | null;
  /**
   * The visually edited pages are bound to this form: text, links, images and
   * list rows changed here still reach the live page, and edits made in /admin
   * flow back into these answers. False for sites edited before binding
   * existed — "Rebuild from form" once to switch them over.
   */
  editorBound?: boolean;
  /** Visible to the public at its URL (Live or Update required). */
  published?: boolean;
  /** The merchant this site belongs to; null = unassigned. */
  merchantId?: string | null;
  merchantName?: string | null;
  /**
   * `values` keys the merchant Profile supplies once linked (business name,
   * phone, address, hours…). Locked in the form: change them on the Profile
   * and the site follows.
   */
  profileFields?: string[];
  /**
   * Profile fields changed on this website only (in the visual editor),
   * mapped to the Profile's value; `values` holds the website's value.
   */
  siteOnlyFields?: Record<string, string>;
}

/* ---------------------------------------------------------------- API I/O */

export interface CreateWebsiteInput {
  values: WebsiteValues;
  status?: WebsiteStatus;
  notes?: string;
  /** Optional — the server derives one from the business name when omitted. */
  slug?: string;
  /** Link the new site to this merchant; its Profile fills the business fields. */
  merchantId?: string;
}

/** PATCH body — `values` replaces the whole answer tree, it is not merged. */
export interface UpdateWebsiteInput {
  values?: WebsiteValues;
  status?: WebsiteStatus;
  notes?: string;
  /** Moves the published URL. Renaming the business alone never moves it. */
  slug?: string;
  /** /admin editor password: a value sets it (min 8), "" turns editing off. */
  adminPassword?: string;
}

export interface WebsiteListQuery {
  /** Matches name, tagline, slug or contact email, case-insensitively. */
  q?: string;
  status?: WebsiteStatus | "";
  /** Only this merchant's sites. */
  merchantId?: string;
  /** Only sites with no merchant. */
  unassigned?: boolean;
  limit?: number;
  offset?: number;
}

export interface WebsiteListMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface WebsiteListResponse {
  data: Website[];
  meta: WebsiteListMeta;
}

/** Everything the list needs about how far a record has been filled in. */
export interface WebsiteProgress {
  /** Steps with no outstanding required fields. */
  complete: number;
  /** Steps that collect answers (the review step is excluded). */
  total: number;
  /** Required fields still missing across the whole form. */
  missing: number;
}

/* ------------------------------------------------------------ .docx import */

/** POST /websites/import-docx — answers read from a content file (not saved). */
export interface WebsiteDocxImport {
  fileName: string;
  values: WebsiteValues;
  /** Human-readable notes: missing sections, fields not found, lines skipped. */
  warnings: string[];
  /** Section codes found: "G", "S1"…"S8", "JSON-LD". */
  sections: string[];
}

/** POST /websites/assets — an uploaded website image. */
export interface WebsiteAsset {
  key: string;
  /** Root-relative (`/api/v1/websites/assets/…`); store this in `values`. */
  url: string;
  sizeBytes: number;
  mimeType: string;
}

/* ------------------------------------------------------------ merchant link */

/** One field where the merchant Profile and the site disagree. */
export interface WebsiteConflict {
  field: string;
  label: string;
  profileValue: string;
  websiteValue: string;
}

/** GET /websites/:key/link-preview?merchantId= */
export interface WebsiteLinkPreview {
  merchantId: string;
  merchantName: string;
  conflicts: WebsiteConflict[];
  profileFields: string[];
}

/** Which side wins for one conflicting field. */
export type ConflictResolution = "profile" | "website";

/** POST /websites/:key/link */
export interface LinkWebsiteInput {
  merchantId: string;
  resolutions?: Record<string, ConflictResolution>;
}

/** GET /websites/:key/merchant-suggestions */
export interface MerchantSuggestion {
  merchantId: string;
  restaurantName: string;
  city: string;
  websiteUrl: string | null;
  score: number;
  reasons: string[];
}

/** POST /websites/:key/merchant — the few things the site can't tell us. */
export interface MerchantFromWebsiteInput {
  accountManagerId?: string;
  merchantCode?: string;
  cuisineCategory?: string;
}

/** GET /merchants/:id/website-prefill */
export interface WebsitePrefill {
  merchantId: string;
  merchantName: string;
  values: WebsiteValues;
  profileFields: string[];
}

/** GET /merchants/:id/websites — the workspace Website tab's three states. */
export interface MerchantWebsites {
  merchantId: string;
  state: "none" | "external" | "managed";
  externalUrl: string | null;
  externalPlatform: string | null;
  websites: Website[];
}

/**
 * How a *new* site relates to a merchant, chosen in the form / .docx import:
 * none (unassigned), an existing merchant, or create one from the answers.
 */
export type MerchantChoice =
  | { mode: "none" }
  | { mode: "existing"; merchantId: string; merchantName: string }
  | { mode: "new" };

/** POST /websites/:key/preview-link — shows a site that isn't public yet. */
export interface WebsitePreviewLink {
  url: string;
  expiresAt: string;
}
