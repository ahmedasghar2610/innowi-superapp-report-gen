import type { BadgeTone } from "@/components/ui";
import type { PartnerContactSource, PartnerContactStatus } from "./types";

export const CONTACT_STATUS_LABEL: Record<PartnerContactStatus, string> = {
  new: "New",
  potential_partner: "Potential partner",
  not_a_fit: "Not a fit",
  customer: "Customer",
  vendor: "Vendor",
  other: "Other",
};

export const CONTACT_STATUS_TONE: Record<PartnerContactStatus, BadgeTone> = {
  new: "accent",
  potential_partner: "success",
  not_a_fit: "outline",
  customer: "neutral",
  vendor: "neutral",
  other: "neutral",
};

export const CONTACT_SOURCE_LABEL: Record<PartnerContactSource, string> = {
  "business-card": "Business card",
  manual: "Added by hand",
  import: "Imported",
};

export function contactSourceLabel(source: string | null | undefined): string {
  if (!source) return "Unknown";
  return CONTACT_SOURCE_LABEL[source as PartnerContactSource] ?? source;
}
