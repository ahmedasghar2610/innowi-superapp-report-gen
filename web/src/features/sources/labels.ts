/**
 * Where a merchant or organization record came from. Mirrors the API's
 * app/models/sources.py — the key is set by whatever created the record and
 * never edited. `null` = created before sources were kept ("Not recorded").
 */
export const MERCHANT_SOURCES = [
  "MANUAL",
  "NEW_DEAL",
  "MERCHANT_IMPORT",
  "CHURN_IMPORT",
  "GOOGLE_PROFILE",
  "SEO_ADS",
  "WEBSITE",
  "SALESFORCE",
  "SAMPLE",
] as const;
export type MerchantSource = (typeof MERCHANT_SOURCES)[number];

export const ORGANIZATION_SOURCES = ["MANUAL", "SPREADSHEET", "PARTNER_LEAD", "BUSINESS_CARD", "AGENT_LIST", "SALESFORCE"] as const;
export type OrganizationSource = (typeof ORGANIZATION_SOURCES)[number];

/** Filter value for "records with no source recorded". */
export const SOURCE_NOT_RECORDED = "NONE";

export const SOURCE_LABEL: Record<MerchantSource | OrganizationSource, string> = {
  MANUAL: "Added by hand",
  NEW_DEAL: "New deal",
  MERCHANT_IMPORT: "Marketing import",
  CHURN_IMPORT: "Churn workbook",
  GOOGLE_PROFILE: "Google Business Profile",
  SEO_ADS: "SEO site / Ads account",
  WEBSITE: "Website",
  SALESFORCE: "Salesforce",
  SAMPLE: "Sample data",
  SPREADSHEET: "Spreadsheet import",
  PARTNER_LEAD: "Partner application",
  BUSINESS_CARD: "Business card",
  AGENT_LIST: "Agent list",
};

/** "Churn workbook", or "Not recorded" for records from before sources were kept. */
export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "Not recorded";
  return SOURCE_LABEL[source as MerchantSource] ?? source;
}

/** One line for a tooltip or a detail row: "Churn workbook · Churned Accounts 2024-26.xlsx / LA". */
export function sourceText(source: string | null | undefined, detail: string | null | undefined): string {
  return detail ? `${sourceLabel(source)} · ${detail}` : sourceLabel(source);
}
