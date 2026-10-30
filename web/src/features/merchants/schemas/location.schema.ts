import { z } from "zod";
import type { CreateLocationInput, Location, UpdateLocationInput } from "@/features/merchants/types";
import { optionalText, type DirtyMap } from "./_shared";

/**
 * Validation for the Location form, mirroring CreateLocationDto (API §6). Every
 * field is optional (a row may be created empty); `isPrimary` is a Yes/No select.
 * The API doesn't enforce a single primary, so this form doesn't either.
 */

export const locationSchema = z.object({
  address: optionalText(300, "Address"),
  city: optionalText(120, "City"),
  state: optionalText(120, "State"),
  zip: optionalText(20, "ZIP"),
  hours: optionalText(500, "Hours"),
  timezone: optionalText(60, "Timezone"),
  isPrimary: z.enum(["true", "false"]),
  napStatus: optionalText(120, "NAP status"),
});

export type LocationFormValues = z.infer<typeof locationSchema>;

export const locationDefaults: LocationFormValues = {
  address: "",
  city: "",
  state: "",
  zip: "",
  hours: "",
  timezone: "",
  isPrimary: "false",
  napStatus: "",
};

export function locationToFormValues(l: Location): LocationFormValues {
  return {
    address: l.address ?? "",
    city: l.city ?? "",
    state: l.state ?? "",
    zip: l.zip ?? "",
    hours: l.hours ?? "",
    timezone: l.timezone ?? "",
    isPrimary: l.isPrimary ? "true" : "false",
    napStatus: l.napStatus ?? "",
  };
}

/** Build the POST body — drop empty text fields, coerce the primary flag. */
export function toCreateLocationInput(values: LocationFormValues): CreateLocationInput {
  const out: CreateLocationInput = { isPrimary: values.isPrimary === "true" };
  const keys = ["address", "city", "state", "zip", "hours", "timezone", "napStatus"] as const;
  for (const k of keys) {
    const v = values[k].trim();
    if (v) out[k] = v;
  }
  return out;
}

/** Build a PATCH body from only changed fields; cleared text fields → null. */
export function toUpdateLocationInput(
  values: LocationFormValues,
  dirty: DirtyMap<LocationFormValues>,
): UpdateLocationInput {
  const out: UpdateLocationInput = {};
  const keys = ["address", "city", "state", "zip", "hours", "timezone", "napStatus"] as const;
  for (const k of keys) {
    if (dirty[k]) out[k] = values[k].trim() || null;
  }
  if (dirty.isPrimary) out.isPrimary = values.isPrimary === "true";
  return out;
}
