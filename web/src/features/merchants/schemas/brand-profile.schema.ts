import { z } from "zod";
import { YES_NO } from "@/features/merchants/types/enums";
import type { BrandProfile, UpsertBrandProfileInput } from "@/features/merchants/types";
import { optionalText, type DirtyMap } from "./_shared";

/**
 * Client-side validation for the Brand profile form (the merchant's 1:1 brand
 * rules — PRD §6.2.5). Every field is optional and bound as a string ("" = not
 * set); `logoVector` is a <select> over the workbook's four-value Yes/No list.
 * The PATCH mapper sends only dirty fields, with `null` for a cleared one, to
 * match the API's merge-upsert contract.
 */

const MAX = {
  brandColors: 1000,
  brandFonts: 500,
  photoLibraryStatus: 1000,
  menuFormat: 1000,
  signatureDishes: 2000,
  toneOfVoice: 1000,
  doNotSay: 2000,
  contentRestrictions: 2000,
} as const;

export const brandProfileSchema = z.object({
  brandColors: optionalText(MAX.brandColors, "Brand colours"),
  brandFonts: optionalText(MAX.brandFonts, "Brand fonts"),
  logoVector: z.enum(["", ...YES_NO]),
  photoLibraryStatus: optionalText(MAX.photoLibraryStatus, "Photo library status"),
  menuFormat: optionalText(MAX.menuFormat, "Menu format"),
  signatureDishes: optionalText(MAX.signatureDishes, "Signature dishes"),
  toneOfVoice: optionalText(MAX.toneOfVoice, "Tone of voice"),
  doNotSay: optionalText(MAX.doNotSay, "Do not say"),
  contentRestrictions: optionalText(MAX.contentRestrictions, "Content restrictions"),
});

/** Raw form values (all strings — this is what React Hook Form holds). */
export type BrandProfileFormValues = z.infer<typeof brandProfileSchema>;

/** The empty form. Every control is controlled, so no `undefined` defaults. */
export const brandProfileDefaults: BrandProfileFormValues = {
  brandColors: "",
  brandFonts: "",
  logoVector: "",
  photoLibraryStatus: "",
  menuFormat: "",
  signatureDishes: "",
  toneOfVoice: "",
  doNotSay: "",
  contentRestrictions: "",
};

/** Seed the form's controlled values from the loaded profile (all-null before the first save). */
export function brandProfileToFormValues(bp: BrandProfile): BrandProfileFormValues {
  return {
    brandColors: bp.brandColors ?? "",
    brandFonts: bp.brandFonts ?? "",
    logoVector: bp.logoVector ?? "",
    photoLibraryStatus: bp.photoLibraryStatus ?? "",
    menuFormat: bp.menuFormat ?? "",
    signatureDishes: bp.signatureDishes ?? "",
    toneOfVoice: bp.toneOfVoice ?? "",
    doNotSay: bp.doNotSay ?? "",
    contentRestrictions: bp.contentRestrictions ?? "",
  };
}

/** The free-text DTO fields, in one place. */
const TEXT_KEYS = [
  "brandColors",
  "brandFonts",
  "photoLibraryStatus",
  "menuFormat",
  "signatureDishes",
  "toneOfVoice",
  "doNotSay",
  "contentRestrictions",
] as const;

/**
 * Build a PATCH body from only the fields React Hook Form marks dirty. A field
 * the user cleared is sent as `null` (clears it server-side); a field set to a
 * value is sent trimmed. Returns `{}` when nothing changed — the caller can
 * then skip the request.
 */
export function toUpsertBrandProfileInput(
  values: BrandProfileFormValues,
  dirty: DirtyMap<BrandProfileFormValues>,
): UpsertBrandProfileInput {
  const out: UpsertBrandProfileInput = {};

  for (const key of TEXT_KEYS) {
    if (!dirty[key]) continue;
    const v = values[key].trim();
    out[key] = v === "" ? null : v;
  }

  if (dirty.logoVector) {
    out.logoVector = values.logoVector || null;
  }

  return out;
}
