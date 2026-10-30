"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, Input, Select, useToast } from "@/components/ui";
import { useUpsertSubscription } from "@/features/merchants/api";
import { useCatalogPackages } from "@/features/catalog/queries";
import { FormDrawer } from "../shared/form-drawer";
import { MERCHANT_SUBSCRIPTION_STATUS } from "@/features/merchants/types/enums";
import { subscriptionStatus as statusLabels } from "@/lib/enums";
import { isApiError } from "@/lib/api/client";
import { formatUsd } from "@/lib/format";
import type { Merchant } from "@/features/merchants/types";
import {
  subscriptionSchema,
  subscriptionDefaults,
  subscriptionToFormValues,
  toCreateSubscriptionInput,
  toUpdateSubscriptionInput,
  type SubscriptionFormValues,
} from "@/features/merchants/schemas/subscription.schema";

const FORM_ID = "subscription-form";

/**
 * Manage a merchant's subscription — tier, status, dates, MRR. One row per
 * merchant, so this is create-or-update in one drawer: with no subscription
 * yet it POSTs the full form; otherwise it PATCHes only the changed fields.
 * Writes require Marketing Manager or above (the API enforces it; the drawer
 * surfaces the 403 as a toast).
 */
export function SubscriptionDrawer({
  merchant,
  open,
  onClose,
}: {
  merchant: Merchant;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const existing = merchant.subscription;
  const isEdit = !!existing;

  const { data: packages, isPending: packagesLoading } = useCatalogPackages();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, dirtyFields },
  } = useForm<SubscriptionFormValues>({
    resolver: zodResolver(subscriptionSchema),
    defaultValues: subscriptionDefaults,
  });

  useEffect(() => {
    if (open) reset(existing ? subscriptionToFormValues(existing) : subscriptionDefaults);
  }, [open, existing, reset]);

  const upsert = useUpsertSubscription();

  // Suggest the catalog price as MRR when the package changes on a new subscription.
  const selectedCode = watch("packageCode");
  const selectedPackage = packages?.find((p) => p.code === selectedCode);

  const onSubmit = handleSubmit((values) => {
    const input = isEdit ? toUpdateSubscriptionInput(values, dirtyFields) : toCreateSubscriptionInput(values);
    if (isEdit && Object.keys(input).length === 0) {
      toast({ variant: "info", title: "No changes to save" });
      onClose();
      return;
    }
    upsert.mutate(
      { merchantId: merchant.id, input },
      {
        onSuccess: (s) => {
          toast({
            variant: "success",
            title: isEdit ? "Subscription updated" : "Subscription created",
            description: `${s.package.code} · ${s.package.name} — ${statusLabels[s.status]?.label ?? s.status}`,
          });
          onClose();
        },
        onError: (err) =>
          toast({
            variant: "error",
            title: isEdit ? "Couldn't update subscription" : "Couldn't create subscription",
            description: isApiError(err)
              ? err.status === 403
                ? "Only Marketing Managers and Admins can change subscriptions."
                : err.messages[0]
              : "Something went wrong. Please try again.",
          }),
      },
    );
  });

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={isEdit ? "Manage subscription" : "Add subscription"}
      description={
        isEdit
          ? `${existing.package.code} · ${existing.package.name}`
          : `${merchant.restaurantName} has no package on file yet.`
      }
      formId={FORM_ID}
      submitLabel={isEdit ? "Save changes" : "Create subscription"}
      busy={upsert.isPending}
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Package" htmlFor="packageCode" required error={errors.packageCode?.message}>
            <Select id="packageCode" aria-invalid={!!errors.packageCode} disabled={packagesLoading} {...register("packageCode")}>
              <option value="">{packagesLoading ? "Loading…" : "Choose a package"}</option>
              {(packages ?? []).map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code} · {p.name} ({formatUsd(p.price)}/mo)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="status" required error={errors.status?.message}>
            <Select id="status" aria-invalid={!!errors.status} {...register("status")}>
              {MERCHANT_SUBSCRIPTION_STATUS.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]?.label ?? s}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" htmlFor="startDate" error={errors.startDate?.message}>
            <Input id="startDate" type="date" aria-invalid={!!errors.startDate} {...register("startDate")} />
          </Field>
          <Field label="Renewal date" htmlFor="renewalDate" error={errors.renewalDate?.message}>
            <Input id="renewalDate" type="date" aria-invalid={!!errors.renewalDate} {...register("renewalDate")} />
          </Field>
        </div>

        <Field
          label="MRR"
          htmlFor="mrr"
          hint={
            selectedPackage
              ? `Catalog price is ${formatUsd(selectedPackage.price)}/mo. Leave blank to record no MRR.`
              : "Monthly recurring revenue. Leave blank to record no MRR."
          }
          error={errors.mrr?.message}
        >
          <Input id="mrr" type="number" min={0} step="0.01" inputMode="decimal" placeholder="0.00" aria-invalid={!!errors.mrr} {...register("mrr")} />
        </Field>
      </form>
    </FormDrawer>
  );
}
