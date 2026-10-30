import { z } from "zod";
import { YES_NO } from "@/features/merchants/types/enums";
import type { CateringProfile, UpsertCateringProfileInput } from "@/features/merchants/types";
import { optionalText, type DirtyMap } from "./_shared";

/**
 * Client-side validation for the Catering form (the merchant's 1:1 catering
 * profile). Every field is optional and bound as a string ("" = not set);
 * `offered` is a <select> over the workbook's four-value Yes/No list. The PATCH
 * mapper sends only dirty fields, with `null` for a cleared one, to match the
 * API's merge-upsert contract.
 */

const MAX = {
  contact: 300,
  leadFlow: 1000,
  minOrder: 200,
  notes: 2000,
} as const;

export const cateringProfileSchema = z.object({
  offered: z.enum(["", ...YES_NO]),
  contact: optionalText(MAX.contact, "Catering contact"),
  leadFlow: optionalText(MAX.leadFlow, "Lead flow"),
  minOrder: optionalText(MAX.minOrder, "Minimum order"),
  notes: optionalText(MAX.notes, "Notes"),
});

/** Raw form values (all strings — this is what React Hook Form holds). */
export type CateringProfileFormValues = z.infer<typeof cateringProfileSchema>;

/** The empty form. Every control is controlled, so no `undefined` defaults. */
export const cateringProfileDefaults: CateringProfileFormValues = {
  offered: "",
  contact: "",
  leadFlow: "",
  minOrder: "",
  notes: "",
};

/** Seed the form's controlled values from the loaded profile (all-null before the first save). */
export function cateringProfileToFormValues(cp: CateringProfile): CateringProfileFormValues {
  return {
    offered: cp.offered ?? "",
    contact: cp.contact ?? "",
    leadFlow: cp.leadFlow ?? "",
    minOrder: cp.minOrder ?? "",
    notes: cp.notes ?? "",
  };
}

/** The free-text DTO fields, in one place. */
const TEXT_KEYS = ["contact", "leadFlow", "minOrder", "notes"] as const;

/**
 * Build a PATCH body from only the fields React Hook Form marks dirty. A field
 * the user cleared is sent as `null` (clears it server-side); a field set to a
 * value is sent trimmed. Returns `{}` when nothing changed — the caller can
 * then skip the request.
 */
export function toUpsertCateringProfileInput(
  values: CateringProfileFormValues,
  dirty: DirtyMap<CateringProfileFormValues>,
): UpsertCateringProfileInput {
  const out: UpsertCateringProfileInput = {};

  for (const key of TEXT_KEYS) {
    if (!dirty[key]) continue;
    const v = values[key].trim();
    out[key] = v === "" ? null : v;
  }

  if (dirty.offered) {
    out.offered = values.offered || null;
  }

  return out;
}
