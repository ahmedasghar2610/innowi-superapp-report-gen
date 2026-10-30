/**
 * Enum vocabularies for the Merchant Profiling module.
 *
 * Sources:
 *  - API_REFERENCE.md §10 — the exact enum values the API accepts/returns.
 *  - Merchant_Profile_System.xlsx "Lists" tab — the workbook dropdowns these
 *    enums encode.
 *  - Central PRD §5.4 — the standardized status vocabulary.
 *
 * Every value is UPPER_SNAKE and case-sensitive. Each enum is a `const` array
 * (iterate it to populate a <Select>) plus a derived string-literal union type,
 * so the runtime values and the type never drift.
 *
 * Enums that exist in the wider Prisma schema but are NOT reachable through any
 * Merchant Profiling endpoint (PackageStatus, KeywordType, OwnerTeam,
 * DeliveryFrequency, DeliveryStatus, OpportunityStatus, Priority —
 * API_REFERENCE.md §10) are intentionally omitted from this module.
 * PromotionStatus WAS in that list until Promotions/Offers were exposed
 * (PRD Appendix C-7 / PROF-01 §6.2.4 — Profiling's master promotions list) —
 * it now has a live section below.
 */

/** Shared helper aliases (documentation only — all are strings at runtime). */
export type Id = string; // cuid, assigned by the server
export type ISODateString = string; // ISO-8601 (e.g. "2026-01-15T00:00:00.000Z")

/* ---- Merchant --------------------------------------------------------------- */

/** Account health traffic-light (Merchants tab · "Account Health"). */
export const ACCOUNT_HEALTH = ["GREEN", "YELLOW", "RED"] as const;
export type AccountHealth = (typeof ACCOUNT_HEALTH)[number];

/**
 * The workbook's "Yes/No" dropdown (Lists tab) — four-valued: Yes | No |
 * Partial | Unknown. Used by every field that reads from that list
 * (alcoholLicense, staffBriefed, brand logoVector, catering
 * offered). Never a boolean on the wire.
 */
export const YES_NO = ["YES", "NO", "PARTIAL", "UNKNOWN"] as const;
export type YesNo = (typeof YES_NO)[number];

/** GET /merchants sort whitelist (API_REFERENCE.md §3.2). */
export const MERCHANT_SORT_BY = ["createdAt", "updatedAt", "restaurantName", "profileCompletionPct"] as const;
export type MerchantSortBy = (typeof MERCHANT_SORT_BY)[number];

export const SORT_ORDER = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDER)[number];

/* ---- Contacts --------------------------------------------------------------- */

/** Contact role (Merchants tab contact columns; the only required contact field). */
export const CONTACT_ROLE = ["OWNER", "MARKETING", "CONTENT_APPROVER", "BILLING", "CATERING"] as const;
export type ContactRole = (typeof CONTACT_ROLE)[number];

/** Preferred channel (Merchants tab · "Preferred Channel"). */
export const PREFERRED_CHANNEL = ["WHATSAPP", "EMAIL", "SMS", "PHONE"] as const;
export type PreferredChannel = (typeof PREFERRED_CHANNEL)[number];

/** Approval responsiveness (Merchants tab · "Approval Responsiveness"). */
export const RESPONSIVENESS = ["FAST", "NORMAL", "SLOW", "VERY_SLOW", "UNKNOWN"] as const;
export type Responsiveness = (typeof RESPONSIVENESS)[number];

/* ---- Keywords --------------------------------------------------------------- */

/** Which workbook keyword column a term belongs to (Primary / Secondary / Location Keywords). */
export const KEYWORD_TYPE = ["PRIMARY", "SECONDARY", "LOCATION"] as const;
export type KeywordType = (typeof KEYWORD_TYPE)[number];

/* ---- Services (Entitlements) ------------------------------------------------ */

/** Merchant↔service link status. */
export const MERCHANT_SERVICE_STATUS = ["ACTIVE", "INACTIVE", "PAUSED"] as const;
export type MerchantServiceStatus = (typeof MERCHANT_SERVICE_STATUS)[number];

/** Catalogue service category (Entitlements tab · "Category"; read-only). */
export const SERVICE_CATEGORY = [
  "CUSTOMER_MARKETING",
  "SEARCH",
  "REPUTATION",
  "CONVERSION",
  "RETENTION",
  "SOCIAL",
  "CREATIVE",
  "REPORTING",
  "REVIEW",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORY)[number];

/* ---- Documents -------------------------------------------------------------- */

/** Document category (Brand Assets §6.2.5 + onboarding files). */
export const DOCUMENT_CATEGORY = ["CONTRACT", "TAX", "MENU", "CONSENT", "BRAND", "REPORT", "OTHER"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORY)[number];

export const DOCUMENT_STATUS = ["ACTIVE", "ARCHIVED"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS)[number];

/* ---- Promotions / Offers ----------------------------------------------------- */

/**
 * Promotion status (PRD Appendix C-7 / PROF-01 §6.2.4 — Profiling owns the
 * master promotions/offers list). Matches the backend's PromotionStatus enum
 * exactly; Merchant_Profile_System.xlsx "Promotions" tab used "Ended" /
 * "No Promotion" as free text, formalized here as ENDED / NO_PROMOTION.
 */
export const PROMOTION_STATUS = ["DRAFT", "SCHEDULED", "ACTIVE", "ENDED", "EXPIRED", "NO_PROMOTION"] as const;
export type PromotionStatus = (typeof PROMOTION_STATUS)[number];

/* ---- Connections (Access items) --------------------------------------------- */

/** Access item criticality (Access tab · "Criticality"). Declared most-critical
 *  first, which is the order the API sorts and the blockers view wants. */
export const ACCESS_CRITICALITY = ["CRITICAL", "CRITICAL_COMPLIANCE", "HIGH", "MEDIUM", "LOW"] as const;
export type AccessCriticality = (typeof ACCESS_CRITICALITY)[number];

/** Access request/verification state (Access tab · "Status"). */
export const ACCESS_STATUS = ["NOT_REQUESTED", "REQUESTED", "RECEIVED", "VERIFIED", "FAILED", "NA"] as const;
export type AccessStatus = (typeof ACCESS_STATUS)[number];

/** Access blocker flag (Access tab · "Flag"). */
export const ACCESS_FLAG = ["BLOCKER", "OPEN", "NONE"] as const;
export type AccessFlag = (typeof ACCESS_FLAG)[number];

/* ---- Profile fields --------------------------------------------------------- */

/**
 * Field attestation state — the Super App PRD §22/§37 confidence-chip
 * taxonomy, one-to-one with the API's `VerificationConfidence` enum (Step 9):
 *   CONFIRMED · INFERRED · UNVERIFIED · OUTDATED · PLACEHOLDER
 * The sixth chip, "Missing", is an absence (empty value) and is derived, not
 * stored. This must match the wire enum exactly, or every field silently
 * falls back to "Unverified" in the UI regardless of what the backend says.
 */
export const VERIFICATION_CONFIDENCE = ["CONFIRMED", "INFERRED", "UNVERIFIED", "OUTDATED", "PLACEHOLDER"] as const;
export type VerificationConfidence = (typeof VERIFICATION_CONFIDENCE)[number];

/**
 * Server-driven profile-field input type (API_REFERENCE.md §4.1). "decimal"
 * covers the master marketing-budget fields (googleAdsBudget/metaAdsBudget —
 * PRD Appendix C-6 / PROF-01 §6.2.4): a non-negative number, rendered as USD.
 */
export const PROFILE_FIELD_TYPE = ["string", "url", "boolean", "date", "enum", "decimal", "integer"] as const;
export type ProfileFieldType = (typeof PROFILE_FIELD_TYPE)[number];

/* ---- Subscription / package -------------------------------------------------- */

/**
 * Merchant subscription status (Prisma `PackageStatus`, now exposed via the
 * `subscription` object embedded on Merchant responses). Values mirror the
 * "Package Status" list on the workbook's Lists tab exactly (Prisma
 * `PackageStatus` has these five values and no others): Onboarding is the
 * pre-launch state, At Risk / Paused / Churned cover the ways a subscription
 * goes inactive.
 */
export const MERCHANT_ACCOUNT_STATUS = ["PROSPECT", "ONBOARDING", "ACTIVE", "PAUSED", "CHURNED"] as const;
export type MerchantAccountStatus = (typeof MERCHANT_ACCOUNT_STATUS)[number];

export const MERCHANT_SUBSCRIPTION_STATUS = [
  "ONBOARDING",
  "ACTIVE",
  "PAUSED",
  "AT_RISK",
  "CHURNED",
] as const;
export type MerchantSubscriptionStatus = (typeof MERCHANT_SUBSCRIPTION_STATUS)[number];
