import { z } from "zod";
import { MERCHANT_SUBSCRIPTION_STATUS } from "@/features/merchants/types/enums";
import type { MerchantSubscription, UpsertSubscriptionInput } from "@/features/merchants/types";
import { optionalCurrency, optionalDate, toCurrencyInput, toDateInput, toIsoDate, type DirtyMap } from "./_shared";

/**
 * Validation for the Manage Subscription drawer, mirroring the API's
 * UpsertSubscriptionDto. `packageCode` and `status` are required in the form
 * (they are required by the API on the first write, and there is no reason to
 * blank them afterwards); dates and MRR are optional and clear with `null`.
 */
export const subscriptionSchema = z.object({
  packageCode: z.string().min(1, "Choose a package."),
  status: z.enum(MERCHANT_SUBSCRIPTION_STATUS),
  startDate: optionalDate,
  renewalDate: optionalDate,
  mrr: optionalCurrency("MRR"),
});

export type SubscriptionFormValues = z.infer<typeof subscriptionSchema>;

export const subscriptionDefaults: SubscriptionFormValues = {
  packageCode: "",
  status: "ONBOARDING",
  startDate: "",
  renewalDate: "",
  mrr: "",
};

export function subscriptionToFormValues(s: MerchantSubscription): SubscriptionFormValues {
  return {
    packageCode: s.package.code,
    status: s.status,
    startDate: toDateInput(s.startDate),
    renewalDate: toDateInput(s.renewalDate),
    mrr: toCurrencyInput(s.mrr),
  };
}

/** First write: send everything that is set. */
export function toCreateSubscriptionInput(values: SubscriptionFormValues): UpsertSubscriptionInput {
  const out: UpsertSubscriptionInput = { packageCode: values.packageCode, status: values.status };
  if (values.startDate) out.startDate = toIsoDate(values.startDate);
  if (values.renewalDate) out.renewalDate = toIsoDate(values.renewalDate);
  if (values.mrr.trim()) out.mrr = Number(values.mrr);
  return out;
}

/** Subsequent writes: only what changed; cleared optionals → null. */
export function toUpdateSubscriptionInput(
  values: SubscriptionFormValues,
  dirty: DirtyMap<SubscriptionFormValues>,
): UpsertSubscriptionInput {
  const out: UpsertSubscriptionInput = {};
  if (dirty.packageCode) out.packageCode = values.packageCode;
  if (dirty.status) out.status = values.status;
  if (dirty.startDate) out.startDate = values.startDate ? toIsoDate(values.startDate) : null;
  if (dirty.renewalDate) out.renewalDate = values.renewalDate ? toIsoDate(values.renewalDate) : null;
  if (dirty.mrr) out.mrr = values.mrr.trim() === "" ? null : Number(values.mrr);
  return out;
}
