import { z } from "zod";
import { ACCOUNT_HEALTH, YES_NO } from "@/features/merchants/types/enums";
import type { CreateMerchantInput, Merchant, UpdateMerchantInput } from "@/features/merchants/types";
import {
  optionalCurrency,
  optionalDate,
  optionalText,
  toCurrencyInput,
  toDateInput,
  toIsoDate,
  type DirtyMap,
} from "./_shared";

/**
 * Client-side validation for the Create Merchant form, mirroring the API's
 * CreateMerchantDto (API_REFERENCE.md §3.1). The backend runs `forbidNonWhitelisted`
 * and rejects unknown properties with a 400, so the form collects only DTO keys
 * and `toCreateMerchantInput` strips anything empty before sending.
 *
 * Design notes:
 *  - Every field except `restaurantName` is optional; the form binds them as
 *    strings (an empty <input>/<select> is ""), which we treat as "not provided".
 *  - `alcoholLicense` is a <select> over the workbook's four-value Yes/No
 *    list (YES | NO | PARTIAL | UNKNOWN); "" means unset.
 *  - `accountHealth` is an enum <select>; "" means "leave unset".
 *  - the two ad budgets are decimals: the form holds them as strings (an empty
 *    <input type="number"> is ""), and the mappers send real numbers, because
 *    the DTO rejects the strings "300" / "300.00" with a 400.
 *  - `websiteUrl` is validated with a light protocol check so the field error
 *    reads nicely; the server does the authoritative URL validation.
 */

const MAX = {
  restaurantName: 200,
  merchantCode: 50,
  legalName: 200,
  cuisineCategory: 120,
  websiteUrl: 500,
  websitePlatform: 120,
  onlineOrdering: 120,
  posSystem: 120,
  customerListSource: 200,
  businessGoals: 2000,
  targetAudience: 2000,
  slowDayparts: 500,
  seasonalPeaks: 500,
  dietaryCerts: 500,
  nextAction: 1000,
  openBlockers: 1000,
  notes: 4000,
  reportFrequency: 100,
  reportRecipients: 500,
} as const;

export const createMerchantSchema = z.object({
  restaurantName: z
    .string()
    .trim()
    .min(1, "Restaurant name is required.")
    .max(MAX.restaurantName, `Restaurant name must be ${MAX.restaurantName} characters or fewer.`),

  merchantCode: optionalText(MAX.merchantCode, "Merchant ID"),
  legalName: optionalText(MAX.legalName, "Legal name"),
  cuisineCategory: optionalText(MAX.cuisineCategory, "Cuisine category"),

  websiteUrl: z
    .string()
    .trim()
    .max(MAX.websiteUrl, `Website URL must be ${MAX.websiteUrl} characters or fewer.`)
    .refine(
      (v) => v === "" || /^https?:\/\/.+/i.test(v),
      "Enter a full URL including http:// or https://.",
    )
    .optional(),

  websitePlatform: optionalText(MAX.websitePlatform, "Website platform"),
  onlineOrdering: optionalText(MAX.onlineOrdering, "Online ordering"),
  posSystem: optionalText(MAX.posSystem, "POS system"),
  customerListSource: optionalText(MAX.customerListSource, "Customer list source"),

  // Master budgets (PRD Appendix C-6 / ADS-02) — non-negative, "" = unset.
  googleAdsBudget: optionalCurrency("Google Ads budget"),
  metaAdsBudget: optionalCurrency("Meta Ads budget"),

  businessGoals: optionalText(MAX.businessGoals, "Business goals"),
  targetAudience: optionalText(MAX.targetAudience, "Target audience"),
  slowDayparts: optionalText(MAX.slowDayparts, "Slow dayparts"),
  seasonalPeaks: optionalText(MAX.seasonalPeaks, "Seasonal peaks"),
  dietaryCerts: optionalText(MAX.dietaryCerts, "Dietary certifications"),
  nextAction: optionalText(MAX.nextAction, "Next action"),
  openBlockers: optionalText(MAX.openBlockers, "Open blockers"),
  notes: optionalText(MAX.notes, "Notes"),
  reportFrequency: optionalText(MAX.reportFrequency, "Report frequency"),
  reportRecipients: optionalText(MAX.reportRecipients, "Report recipients"),

  // Workbook Yes/No list via <select>. Empty = unset.
  alcoholLicense: z.enum(["", ...YES_NO]).optional(),

  // Non-negative integer from a number input; "" = unset.
  locationCount: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d+$/.test(v), "Enter a whole number of locations."),

  // Enum <select>. Empty = unset.
  accountHealth: z.enum(["", ...ACCOUNT_HEALTH]).optional(),

  // Account manager picker (cuid from GET /account-managers). Empty = unassigned.
  accountManagerId: z.string().trim().max(64),

  onboardingDate: optionalDate,
  goLiveDate: optionalDate,
});

/** Raw form values (all strings — this is what React Hook Form holds). */
export type CreateMerchantFormValues = z.infer<typeof createMerchantSchema>;

/** The empty form. Every control is controlled, so no `undefined` defaults. */
export const createMerchantDefaults: CreateMerchantFormValues = {
  restaurantName: "",
  merchantCode: "",
  legalName: "",
  cuisineCategory: "",
  websiteUrl: "",
  websitePlatform: "",
  onlineOrdering: "",
  posSystem: "",
  customerListSource: "",
  googleAdsBudget: "",
  metaAdsBudget: "",
  businessGoals: "",
  targetAudience: "",
  slowDayparts: "",
  seasonalPeaks: "",
  dietaryCerts: "",
  nextAction: "",
  openBlockers: "",
  notes: "",
  reportFrequency: "",
  reportRecipients: "",
  alcoholLicense: "",
  locationCount: "",
  accountHealth: "",
  accountManagerId: "",
  onboardingDate: "",
  goLiveDate: "",
};

/**
 * Map validated form values to the API payload: drop empty strings entirely
 * (so we never send `""` for a field the server treats as optional), coerce the
 * alcohol-license tri-state to a real boolean, and convert the date inputs to
 * ISO-8601 timestamps (the API stores DateTime).
 */
export function toCreateMerchantInput(values: CreateMerchantFormValues): CreateMerchantInput {
  const out: CreateMerchantInput = { restaurantName: values.restaurantName.trim() };

  for (const key of TEXT_KEYS) {
    const v = values[key]?.trim();
    if (v) out[key] = v;
  }

  for (const key of CURRENCY_KEYS) {
    const v = values[key]?.trim();
    if (v) out[key] = Number(v);
  }

  for (const key of YES_NO_KEYS) {
    const v = values[key];
    if (v) out[key] = v;
  }

  if (values.locationCount.trim()) out.locationCount = Number(values.locationCount);

  if (values.accountHealth) out.accountHealth = values.accountHealth;
  if (values.accountManagerId) out.accountManagerId = values.accountManagerId;

  if (values.onboardingDate) out.onboardingDate = toIsoDate(values.onboardingDate);
  if (values.goLiveDate) out.goLiveDate = toIsoDate(values.goLiveDate);

  return out;
}

/* ---- Edit -------------------------------------------------------------------
   The Create schema is reused for editing: `restaurantName` stays required (a
   merchant can't have its unique name blanked) and every other rule is identical
   to the DTO. Edit adds two mappers — one to seed the form from a loaded
   Merchant, one to build a minimal PATCH body from only the changed fields. */

/** Seed the form's controlled values from an existing merchant record. */
export function merchantToFormValues(m: Merchant): CreateMerchantFormValues {
  return {
    restaurantName: m.restaurantName ?? "",
    merchantCode: m.merchantCode ?? "",
    legalName: m.legalName ?? "",
    cuisineCategory: m.cuisineCategory ?? "",
    websiteUrl: m.websiteUrl ?? "",
    websitePlatform: m.websitePlatform ?? "",
    onlineOrdering: m.onlineOrdering ?? "",
    posSystem: m.posSystem ?? "",
    customerListSource: m.customerListSource ?? "",
    googleAdsBudget: toCurrencyInput(m.googleAdsBudget),
    metaAdsBudget: toCurrencyInput(m.metaAdsBudget),
    businessGoals: m.businessGoals ?? "",
    targetAudience: m.targetAudience ?? "",
    slowDayparts: m.slowDayparts ?? "",
    seasonalPeaks: m.seasonalPeaks ?? "",
    dietaryCerts: m.dietaryCerts ?? "",
    nextAction: m.nextAction ?? "",
    openBlockers: m.openBlockers ?? "",
    notes: m.notes ?? "",
    reportFrequency: m.reportFrequency ?? "",
    reportRecipients: m.reportRecipients ?? "",
    alcoholLicense: m.alcoholLicense ?? "",
    locationCount: m.locationCount === null ? "" : String(m.locationCount),
    accountHealth: m.accountHealth ?? "",
    accountManagerId: m.accountManagerId ?? "",
    onboardingDate: toDateInput(m.onboardingDate),
    goLiveDate: toDateInput(m.goLiveDate),
  };
}

/** The decimal DTO fields — mapped separately because they must go as numbers. */
const CURRENCY_KEYS = ["googleAdsBudget", "metaAdsBudget"] as const;

/** The workbook Yes/No fields — sent as the enum string, "" dropped / nulled. */
const YES_NO_KEYS = ["alcoholLicense"] as const;

/** The DTO text fields, in one place (shared by create + update mappers). */
const TEXT_KEYS = [
  "merchantCode",
  "legalName",
  "cuisineCategory",
  "websiteUrl",
  "websitePlatform",
  "onlineOrdering",
  "posSystem",
  "customerListSource",
  "businessGoals",
  "targetAudience",
  "slowDayparts",
  "seasonalPeaks",
  "dietaryCerts",
  "nextAction",
  "openBlockers",
  "notes",
  "reportFrequency",
  "reportRecipients",
] as const;

/**
 * Build a PATCH body from only the fields React Hook Form marks dirty, so we
 * send a true partial update. A field the user cleared is sent as `null` (clear
 * it server-side); a field set to a value is sent as that value. `restaurantName`
 * is only included when changed and is never null. Returns `{}` when nothing
 * changed — the caller can then skip the request.
 */
export function toUpdateMerchantInput(
  values: CreateMerchantFormValues,
  dirty: DirtyMap<CreateMerchantFormValues>,
): UpdateMerchantInput {
  const out: UpdateMerchantInput = {};

  if (dirty.restaurantName) {
    out.restaurantName = values.restaurantName.trim();
  }

  for (const key of TEXT_KEYS) {
    if (!dirty[key]) continue;
    const v = values[key]?.trim() ?? "";
    out[key] = v === "" ? null : v;
  }

  for (const key of CURRENCY_KEYS) {
    if (!dirty[key]) continue;
    const v = values[key]?.trim() ?? "";
    // Cleared -> null (server nulls the column). "0" is a real budget, not empty.
    out[key] = v === "" ? null : Number(v);
  }

  for (const key of YES_NO_KEYS) {
    if (!dirty[key]) continue;
    out[key] = values[key] || null;
  }

  if (dirty.locationCount) {
    const v = values.locationCount.trim();
    out.locationCount = v === "" ? null : Number(v);
  }

  if (dirty.accountHealth) {
    out.accountHealth = values.accountHealth ? values.accountHealth : null;
  }

  if (dirty.accountManagerId) {
    out.accountManagerId = values.accountManagerId || null;
  }

  if (dirty.onboardingDate) {
    out.onboardingDate = values.onboardingDate ? toIsoDate(values.onboardingDate) : null;
  }

  if (dirty.goLiveDate) {
    out.goLiveDate = values.goLiveDate ? toIsoDate(values.goLiveDate) : null;
  }

  return out;
}
