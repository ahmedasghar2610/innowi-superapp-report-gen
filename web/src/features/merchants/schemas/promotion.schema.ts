import { z } from "zod";
import { PROMOTION_STATUS, YES_NO } from "@/features/merchants/types/enums";
import type { CreatePromotionInput, Promotion, UpdatePromotionInput } from "@/features/merchants/types";
import { optionalDate, optionalText, toDateInput, toIsoDate, type DirtyMap } from "./_shared";

/**
 * Validation for the Promotion / Offer form, mirroring CreatePromotionDto
 * (PRD Appendix C-7 / PROF-01 §6.2.4 — Profiling's master promotions list).
 * Every field is optional at the API layer; `status` defaults like the
 * backend's NO_PROMOTION default so an untouched form still submits cleanly.
 */

const MAX = {
  promoName: 300,
  offerType: 200,
  offerValue: 300,
  promoCode: 200,
  channels: 500,
  redemptions: 200,
  redemptionMethod: 300,
  approvalOwner: 200,
  blackoutDates: 500,
  notes: 4000,
} as const;

export const promotionSchema = z.object({
  promoName: optionalText(MAX.promoName, "Promotion name"),
  offerType: optionalText(MAX.offerType, "Offer type"),
  offerValue: optionalText(MAX.offerValue, "Offer value"),
  promoCode: optionalText(MAX.promoCode, "Promo code"),
  channels: optionalText(MAX.channels, "Channels"),
  startDate: optionalDate,
  endDate: optionalDate,
  status: z.enum(PROMOTION_STATUS),
  redemptions: optionalText(MAX.redemptions, "Redemptions"),
  redemptionMethod: optionalText(MAX.redemptionMethod, "Redemption method"),
  approvalOwner: optionalText(MAX.approvalOwner, "Approval owner"),
  staffBriefed: z.enum(["", ...YES_NO]), // workbook Yes/No list; "" = unset
  blackoutDates: optionalText(MAX.blackoutDates, "Blackout dates"),
  notes: optionalText(MAX.notes, "Notes"),
});

export type PromotionFormValues = z.infer<typeof promotionSchema>;

export const promotionDefaults: PromotionFormValues = {
  promoName: "",
  offerType: "",
  offerValue: "",
  promoCode: "",
  channels: "",
  startDate: "",
  endDate: "",
  status: "NO_PROMOTION",
  redemptions: "",
  redemptionMethod: "",
  approvalOwner: "",
  staffBriefed: "",
  blackoutDates: "",
  notes: "",
};

export function promotionToFormValues(p: Promotion): PromotionFormValues {
  return {
    promoName: p.promoName ?? "",
    offerType: p.offerType ?? "",
    offerValue: p.offerValue ?? "",
    promoCode: p.promoCode ?? "",
    channels: p.channels ?? "",
    startDate: toDateInput(p.startDate),
    endDate: toDateInput(p.endDate),
    status: p.status,
    redemptions: p.redemptions ?? "",
    redemptionMethod: p.redemptionMethod ?? "",
    approvalOwner: p.approvalOwner ?? "",
    staffBriefed: p.staffBriefed ?? "",
    blackoutDates: p.blackoutDates ?? "",
    notes: p.notes ?? "",
  };
}

/** The DTO text fields, in one place (shared by create + update mappers). */
const TEXT_KEYS = [
  "promoName",
  "offerType",
  "offerValue",
  "promoCode",
  "channels",
  "redemptions",
  "redemptionMethod",
  "approvalOwner",
  "blackoutDates",
  "notes",
] as const;

export function toCreatePromotionInput(values: PromotionFormValues): CreatePromotionInput {
  const out: CreatePromotionInput = { status: values.status };

  for (const key of TEXT_KEYS) {
    const v = values[key]?.trim();
    if (v) out[key] = v;
  }

  if (values.startDate) out.startDate = toIsoDate(values.startDate);
  if (values.endDate) out.endDate = toIsoDate(values.endDate);

  if (values.staffBriefed) out.staffBriefed = values.staffBriefed;

  return out;
}

/**
 * Build a PATCH body from only the fields React Hook Form marks dirty. A
 * cleared optional is sent as `null`; `status` is never null. Returns `{}`
 * when nothing changed — the caller can then skip the request.
 */
export function toUpdatePromotionInput(
  values: PromotionFormValues,
  dirty: DirtyMap<PromotionFormValues>,
): UpdatePromotionInput {
  const out: UpdatePromotionInput = {};

  if (dirty.status) out.status = values.status;

  for (const key of TEXT_KEYS) {
    if (!dirty[key]) continue;
    const v = values[key]?.trim() ?? "";
    out[key] = v === "" ? null : v;
  }

  if (dirty.startDate) out.startDate = values.startDate ? toIsoDate(values.startDate) : null;
  if (dirty.endDate) out.endDate = values.endDate ? toIsoDate(values.endDate) : null;

  if (dirty.staffBriefed) {
    out.staffBriefed = values.staffBriefed || null;
  }

  return out;
}
