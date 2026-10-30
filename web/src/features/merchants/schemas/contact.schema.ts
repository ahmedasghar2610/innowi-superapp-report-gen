import { z } from "zod";
import { CONTACT_ROLE, PREFERRED_CHANNEL, RESPONSIVENESS } from "@/features/merchants/types/enums";
import type { Contact, CreateContactInput, UpdateContactInput } from "@/features/merchants/types";
import { optionalText, type DirtyMap } from "./_shared";

/**
 * Validation for the Contact form, mirroring CreateContactDto (API §5). `role`
 * is the only required field. `preferredChannel` and `responsiveness` are
 * nullable enums, so their selects allow an empty "" (= not set); the free-text
 * fields are optional and empty means "not set".
 */

export const contactSchema = z.object({
  role: z.enum(CONTACT_ROLE),
  name: optionalText(160, "Name"),
  email: z
    .string()
    .trim()
    .max(320, "Email must be 320 characters or fewer.")
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address."),
  phone: optionalText(60, "Phone"),
  preferredChannel: z.enum(["", ...PREFERRED_CHANNEL]),
  language: optionalText(60, "Language"),
  responsiveness: z.enum(["", ...RESPONSIVENESS]),
});

export type ContactFormValues = z.infer<typeof contactSchema>;

export const contactDefaults: ContactFormValues = {
  role: "OWNER",
  name: "",
  email: "",
  phone: "",
  preferredChannel: "",
  language: "",
  responsiveness: "",
};

export function contactToFormValues(c: Contact): ContactFormValues {
  return {
    role: c.role,
    name: c.name ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    preferredChannel: c.preferredChannel ?? "",
    language: c.language ?? "",
    responsiveness: c.responsiveness ?? "",
  };
}

/** Build the POST body — role always, other fields only when non-empty. */
export function toCreateContactInput(values: ContactFormValues): CreateContactInput {
  const out: CreateContactInput = { role: values.role };
  if (values.name.trim()) out.name = values.name.trim();
  if (values.email.trim()) out.email = values.email.trim();
  if (values.phone.trim()) out.phone = values.phone.trim();
  if (values.language.trim()) out.language = values.language.trim();
  if (values.preferredChannel) out.preferredChannel = values.preferredChannel;
  if (values.responsiveness) out.responsiveness = values.responsiveness;
  return out;
}

/** Build a PATCH body from only changed fields; cleared fields → null. */
export function toUpdateContactInput(
  values: ContactFormValues,
  dirty: DirtyMap<ContactFormValues>,
): UpdateContactInput {
  const out: UpdateContactInput = {};
  if (dirty.role) out.role = values.role;
  if (dirty.name) out.name = values.name.trim() || null;
  if (dirty.email) out.email = values.email.trim() || null;
  if (dirty.phone) out.phone = values.phone.trim() || null;
  if (dirty.language) out.language = values.language.trim() || null;
  if (dirty.preferredChannel) out.preferredChannel = values.preferredChannel || null;
  if (dirty.responsiveness) out.responsiveness = values.responsiveness || null;
  return out;
}
