import type { BadgeTone } from "@/components/ui/badge";

/**
 * Enum → display metadata. Every API enum is UPPER_SNAKE and case-sensitive
 * (API_REFERENCE.md §10); this is the single place we translate to human labels
 * and status tones, so no component ever hard-codes an enum string.
 *
 * Only the enums the Merchant Profiling UI renders are included here; extend as
 * feature screens are built.
 */
type EnumMeta = { label: string; tone: BadgeTone };

export const accountHealth: Record<string, EnumMeta> = {
  GREEN: { label: "Green", tone: "success" },
  YELLOW: { label: "Yellow", tone: "warning" },
  RED: { label: "Red", tone: "danger" },
};

export const accessStatus: Record<string, EnumMeta> = {
  NOT_REQUESTED: { label: "Not Requested", tone: "neutral" },
  REQUESTED: { label: "Requested", tone: "warning" },
  RECEIVED: { label: "Received", tone: "accent" },
  VERIFIED: { label: "Verified", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  NA: { label: "N/A", tone: "neutral" },
};

export const accessFlag: Record<string, EnumMeta> = {
  BLOCKER: { label: "Blocker", tone: "danger" },
  OPEN: { label: "Open", tone: "neutral" },
  NONE: { label: "None", tone: "neutral" },
};

export const accessCriticality: Record<string, EnumMeta> = {
  CRITICAL: { label: "Critical", tone: "danger" },
  CRITICAL_COMPLIANCE: { label: "Critical · Compliance", tone: "danger" },
  HIGH: { label: "High", tone: "warning" },
  MEDIUM: { label: "Medium", tone: "neutral" },
  LOW: { label: "Low", tone: "neutral" },
};

export const merchantServiceStatus: Record<string, EnumMeta> = {
  ACTIVE: { label: "Active", tone: "success" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
  PAUSED: { label: "Paused", tone: "warning" },
};

export const documentStatus: Record<string, EnumMeta> = {
  ACTIVE: { label: "Active", tone: "success" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

export const verificationConfidence: Record<string, EnumMeta> = {
  CONFIRMED: { label: "Confirmed", tone: "success" },
  INFERRED: { label: "Inferred", tone: "accent" },
  UNVERIFIED: { label: "Unverified", tone: "neutral" },
  OUTDATED: { label: "Outdated", tone: "warning" },
  PLACEHOLDER: { label: "Placeholder", tone: "danger" },
};

/** Workbook Yes/No list — rendered as text, not a status tone. */
export const yesNo: Record<string, string> = {
  YES: "Yes",
  NO: "No",
  PARTIAL: "Partial",
  UNKNOWN: "Unknown",
};

export const keywordType: Record<string, string> = {
  PRIMARY: "Primary",
  SECONDARY: "Secondary",
  LOCATION: "Location",
};

export const contactRole: Record<string, string> = {
  OWNER: "Owner",
  MARKETING: "Marketing",
  CONTENT_APPROVER: "Content Approver",
  BILLING: "Billing",
  CATERING: "Catering",
};

export const preferredChannel: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  SMS: "SMS",
  PHONE: "Phone",
};

export const responsiveness: Record<string, string> = {
  FAST: "Fast (<24h)",
  NORMAL: "Normal (1–2 days)",
  SLOW: "Slow (3–5 days)",
  VERY_SLOW: "Very Slow (5+ days)",
  UNKNOWN: "Unknown",
};

export const subscriptionStatus: Record<string, EnumMeta> = {
  ONBOARDING: { label: "Onboarding", tone: "accent" },
  ACTIVE: { label: "Active", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  AT_RISK: { label: "At Risk", tone: "warning" },
  CHURNED: { label: "Churned", tone: "danger" },
  BLOCKED: { label: "Blocked", tone: "danger" },
};

export const auditAction: Record<string, EnumMeta> = {
  CREATE: { label: "Created", tone: "success" },
  UPDATE: { label: "Updated", tone: "accent" },
  DELETE: { label: "Deleted", tone: "danger" },
};

export const auditOutcome: Record<string, EnumMeta> = {
  SUCCESS: { label: "Success", tone: "success" },
  FAILURE: { label: "Failed", tone: "danger" },
};

export const documentCategory: Record<string, string> = {
  CONTRACT: "Contract",
  TAX: "Tax",
  MENU: "Menu",
  CONSENT: "Consent",
  BRAND: "Brand",
  REPORT: "Report",
  OTHER: "Other",
};

export const brandAssetType: Record<string, string> = {
  LOGO: "Logo",
  MENU: "Menu",
  IMAGE: "Image",
  VIDEO: "Video",
  BRAND_GUIDELINES: "Brand guidelines",
  OTHER: "Other",
};
