import { z } from "zod";
import { ACCESS_CRITICALITY, ACCESS_STATUS, ACCESS_FLAG } from "@/features/merchants/types/enums";
import type {
  Connection,
  CreateConnectionInput,
  UpdateConnectionInput,
} from "@/features/merchants/types";
import { optionalDate, optionalText, toDateInput, toIsoDate, type DirtyMap } from "./_shared";

/**
 * Validation for the Connection (access item) form, mirroring CreateConnectionDto
 * (API_REFERENCE.md §9). `accessItem` and `criticality` are required; the other
 * selects (status, flag, verified) always carry a concrete value so the form is
 * never in an ambiguous state, and the free-text / date fields are optional.
 */

export const connectionSchema = z.object({
  accessItem: z
    .string()
    .trim()
    .min(1, "Access item is required.")
    .max(200, "Access item must be 200 characters or fewer."),
  criticality: z.enum(ACCESS_CRITICALITY),
  status: z.enum(ACCESS_STATUS),
  flag: z.enum(ACCESS_FLAG),
  owner: optionalText(120, "Owner"),
  notes: optionalText(2000, "Notes"),
  dateRequested: optionalDate,
  dateReceived: optionalDate,
  verified: z.enum(["true", "false"]),
  verifiedDate: optionalDate,
  expiry: optionalDate,
});

export type ConnectionFormValues = z.infer<typeof connectionSchema>;

/** A blank create form (mirrors the server defaults: NOT_REQUESTED / OPEN). */
export const connectionDefaults: ConnectionFormValues = {
  accessItem: "",
  criticality: "MEDIUM",
  status: "NOT_REQUESTED",
  flag: "OPEN",
  owner: "",
  notes: "",
  dateRequested: "",
  dateReceived: "",
  verified: "false",
  verifiedDate: "",
  expiry: "",
};

/** Seed the form from an existing connection (edit mode). */
export function connectionToFormValues(c: Connection): ConnectionFormValues {
  return {
    accessItem: c.accessItem ?? "",
    criticality: c.criticality,
    status: c.status,
    flag: c.flag,
    owner: c.owner ?? "",
    notes: c.notes ?? "",
    dateRequested: toDateInput(c.dateRequested),
    dateReceived: toDateInput(c.dateReceived),
    verified: c.verified ? "true" : "false",
    verifiedDate: toDateInput(c.verifiedDate),
    expiry: toDateInput(c.expiry),
  };
}

/** Build the POST body — drop empty optionals, coerce dates + the verified flag. */
export function toCreateConnectionInput(values: ConnectionFormValues): CreateConnectionInput {
  const out: CreateConnectionInput = {
    accessItem: values.accessItem.trim(),
    criticality: values.criticality,
    status: values.status,
    flag: values.flag,
    verified: values.verified === "true",
  };
  if (values.owner.trim()) out.owner = values.owner.trim();
  if (values.notes.trim()) out.notes = values.notes.trim();
  if (values.dateRequested) out.dateRequested = toIsoDate(values.dateRequested);
  if (values.dateReceived) out.dateReceived = toIsoDate(values.dateReceived);
  if (values.verifiedDate) out.verifiedDate = toIsoDate(values.verifiedDate);
  if (values.expiry) out.expiry = toIsoDate(values.expiry);
  return out;
}

/**
 * Build a PATCH body from only the fields the user changed. Cleared text/date
 * fields are sent as `null`; enums and the verified flag as their value.
 */
export function toUpdateConnectionInput(
  values: ConnectionFormValues,
  dirty: DirtyMap<ConnectionFormValues>,
): UpdateConnectionInput {
  const out: UpdateConnectionInput = {};

  if (dirty.accessItem) out.accessItem = values.accessItem.trim();
  if (dirty.criticality) out.criticality = values.criticality;
  if (dirty.status) out.status = values.status;
  if (dirty.flag) out.flag = values.flag;
  if (dirty.verified) out.verified = values.verified === "true";

  if (dirty.owner) out.owner = values.owner.trim() || null;
  if (dirty.notes) out.notes = values.notes.trim() || null;
  if (dirty.dateRequested) out.dateRequested = values.dateRequested ? toIsoDate(values.dateRequested) : null;
  if (dirty.dateReceived) out.dateReceived = values.dateReceived ? toIsoDate(values.dateReceived) : null;
  if (dirty.verifiedDate) out.verifiedDate = values.verifiedDate ? toIsoDate(values.verifiedDate) : null;
  if (dirty.expiry) out.expiry = values.expiry ? toIsoDate(values.expiry) : null;

  return out;
}
