import type { WebsiteFormStep } from "@/features/websites/types";
import type { CreateMerchantFormValues } from "@/features/merchants/schemas/merchant.schema";

export type MerchantFormStep = WebsiteFormStep & { fields: (keyof CreateMerchantFormValues)[] };

/**
 * The form's steps — same stepped, centered layout as the website intake
 * questionnaire. Only the restaurant name is required, so "Create merchant"
 * is offered on every step; "Next" walks through the optional sections.
 */
export const MERCHANT_FORM_STEPS: MerchantFormStep[] = [
  { id: "identity", label: "Identity", title: "Identity", description: "Who the merchant is and who looks after them.", entries: [],
    fields: ["restaurantName", "merchantCode", "legalName", "cuisineCategory", "accountHealth", "accountManagerId"] },
  { id: "web", label: "Web", title: "Web presence", description: "Where the merchant already is online.", entries: [],
    fields: ["websiteUrl", "websitePlatform", "onlineOrdering", "posSystem"] },
  { id: "operations", label: "Operations", title: "Operations", description: "How the business runs day to day.", entries: [],
    fields: ["customerListSource", "alcoholLicense", "locationCount", "slowDayparts", "seasonalPeaks", "dietaryCerts", "targetAudience", "businessGoals"] },
  { id: "budgets", label: "Budgets", title: "Marketing budgets", description: "Master budget fields the Ads modules read from.", entries: [],
    fields: ["googleAdsBudget", "metaAdsBudget"] },
  { id: "lifecycle", label: "Lifecycle", title: "Lifecycle", description: "Dates, reporting and what happens next.", entries: [],
    fields: ["onboardingDate", "goLiveDate", "reportFrequency", "reportRecipients", "nextAction", "openBlockers", "notes"] },
  { id: "review", label: "Review", title: "Review", description: "Check what you've entered, then create the merchant.", entries: [], review: true, fields: [] },
];

/** Labels for the review table. */
export const MERCHANT_FIELD_LABELS: Record<keyof CreateMerchantFormValues, string> = {
  restaurantName: "Restaurant name", merchantCode: "Merchant ID", legalName: "Legal name", cuisineCategory: "Cuisine category",
  accountHealth: "Account health", accountManagerId: "Account manager", websiteUrl: "Website URL", websitePlatform: "Website platform",
  onlineOrdering: "Online ordering", posSystem: "POS system", customerListSource: "Customer list source", alcoholLicense: "Alcohol license",
  locationCount: "Number of locations", slowDayparts: "Slow dayparts", seasonalPeaks: "Seasonal peaks", dietaryCerts: "Dietary certifications",
  targetAudience: "Target audience", businessGoals: "Business goals", googleAdsBudget: "Google Ads budget", metaAdsBudget: "Meta Ads budget",
  onboardingDate: "Onboarding date", goLiveDate: "Go-live date", reportFrequency: "Report frequency", reportRecipients: "Report recipients",
  nextAction: "Next action", openBlockers: "Open blockers", notes: "Notes",
};

