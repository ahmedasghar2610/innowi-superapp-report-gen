import { z } from "zod";
import { MERCHANT_SERVICE_STATUS } from "@/features/merchants/types/enums";
import type {
  CreateMerchantServiceInput,
  MerchantService,
  UpdateMerchantServiceInput,
} from "@/features/merchants/types";
import { optionalDate, toDateInput, toIsoDate, type DirtyMap } from "./_shared";

/**
 * Validation for the Service (entitlement) form. `serviceId` is required only
 * when activating (it's picked from the temporary catalogue and is not editable
 * afterwards — the DTO rejects it on update), so it's validated in the component
 * by mode. `status` always carries a concrete value; date/notes are optional.
 */

export const serviceSchema = z.object({
  serviceId: z.string(),
  status: z.enum(MERCHANT_SERVICE_STATUS),
  activatedAt: optionalDate,
  notes: z.string().trim().max(2000, "Notes must be 2000 characters or fewer."),
});

export type ServiceFormValues = z.infer<typeof serviceSchema>;

export const serviceDefaults: ServiceFormValues = {
  serviceId: "",
  status: "ACTIVE",
  activatedAt: "",
  notes: "",
};

/** Seed the form from an existing link row (edit mode). */
export function serviceToFormValues(s: MerchantService): ServiceFormValues {
  return {
    serviceId: s.serviceId,
    status: s.status,
    activatedAt: toDateInput(s.activatedAt),
    notes: s.notes ?? "",
  };
}

/** POST body for activation (serviceId + optional fields). */
export function toCreateMerchantServiceInput(values: ServiceFormValues): CreateMerchantServiceInput {
  const out: CreateMerchantServiceInput = { serviceId: values.serviceId, status: values.status };
  if (values.activatedAt) out.activatedAt = toIsoDate(values.activatedAt);
  if (values.notes.trim()) out.notes = values.notes.trim();
  return out;
}

/**
 * PATCH body from only changed fields (status / activatedAt / notes — never
 * serviceId, which the DTO rejects). Cleared date/notes → null.
 */
export function toUpdateMerchantServiceInput(
  values: ServiceFormValues,
  dirty: DirtyMap<ServiceFormValues>,
): UpdateMerchantServiceInput {
  const out: UpdateMerchantServiceInput = {};
  if (dirty.status) out.status = values.status;
  if (dirty.activatedAt) out.activatedAt = values.activatedAt ? toIsoDate(values.activatedAt) : null;
  if (dirty.notes) out.notes = values.notes.trim() || null;
  return out;
}
