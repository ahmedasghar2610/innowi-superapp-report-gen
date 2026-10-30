"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { useCreatePromotion, useUpdatePromotion } from "@/features/merchants/api";
import { FormDrawer } from "../shared/form-drawer";
import { YES_NO } from "@/features/merchants/types/enums";
import { yesNo as yesNoLabels } from "@/lib/enums";
import { PROMOTION_STATUS } from "@/features/merchants/types/enums";
import { isApiError } from "@/lib/api/client";
import { humanize } from "@/lib/format";
import type { Promotion } from "@/features/merchants/types";
import {
  promotionSchema,
  promotionDefaults,
  promotionToFormValues,
  toCreatePromotionInput,
  toUpdatePromotionInput,
  type PromotionFormValues,
} from "@/features/merchants/schemas/promotion.schema";

const FORM_ID = "promotion-form";

/**
 * Create / edit a promotion / offer — Profiling's master list (PRD Appendix
 * C-7 / PROF-01 §6.2.4). Passing `promotion` is edit mode (seeds + PATCHes
 * only changed fields); omitting it is create (POST).
 */
export function PromotionFormDrawer({
  merchantId,
  open,
  onClose,
  promotion,
}: {
  merchantId: string;
  open: boolean;
  onClose: () => void;
  promotion?: Promotion;
}) {
  const { toast } = useToast();
  const isEdit = !!promotion;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, dirtyFields },
  } = useForm<PromotionFormValues>({
    resolver: zodResolver(promotionSchema),
    defaultValues: promotionDefaults,
  });

  useEffect(() => {
    if (open) reset(promotion ? promotionToFormValues(promotion) : promotionDefaults);
  }, [open, promotion, reset]);

  const createPromo = useCreatePromotion();
  const updatePromo = useUpdatePromotion();
  const busy = createPromo.isPending || updatePromo.isPending;

  function onFail(err: unknown, fallback: string) {
    toast({
      variant: "error",
      title: fallback,
      description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
    });
  }

  const onSubmit = handleSubmit((values) => {
    if (isEdit && promotion) {
      const input = toUpdatePromotionInput(values, dirtyFields);
      if (Object.keys(input).length === 0) {
        toast({ variant: "info", title: "No changes to save" });
        onClose();
        return;
      }
      updatePromo.mutate(
        { merchantId, id: promotion.id, input },
        {
          onSuccess: (p) => {
            toast({ variant: "success", title: "Promotion updated", description: p.promoName ?? undefined });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't update promotion"),
        },
      );
    } else {
      const input = toCreatePromotionInput(values);
      createPromo.mutate(
        { merchantId, input },
        {
          onSuccess: (p) => {
            toast({ variant: "success", title: "Promotion added", description: p.promoName ?? undefined });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't add promotion"),
        },
      );
    }
  });

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={isEdit ? "Edit promotion" : "New promotion"}
      description={isEdit ? (promotion?.promoName ?? "Promotion") : "Add a promotion or offer for this merchant."}
      formId={FORM_ID}
      submitLabel={isEdit ? "Save changes" : "Add promotion"}
      busy={busy}
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Promotion name" htmlFor="promoName" error={errors.promoName?.message}>
            <Input id="promoName" placeholder="e.g. Back to School Specials" aria-invalid={!!errors.promoName} {...register("promoName")} />
          </Field>
          <Field label="Status" htmlFor="status" error={errors.status?.message}>
            <Select id="status" aria-invalid={!!errors.status} {...register("status")}>
              {PROMOTION_STATUS.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Offer type" htmlFor="offerType" hint="e.g. Price point / combo" error={errors.offerType?.message}>
            <Input id="offerType" aria-invalid={!!errors.offerType} {...register("offerType")} />
          </Field>
          <Field label="Offer value" htmlFor="offerValue" hint="e.g. Combos from $10.99" error={errors.offerValue?.message}>
            <Input id="offerValue" aria-invalid={!!errors.offerValue} {...register("offerValue")} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Promo code" htmlFor="promoCode" error={errors.promoCode?.message}>
            <Input id="promoCode" aria-invalid={!!errors.promoCode} {...register("promoCode")} />
          </Field>
          <Field label="Channels" htmlFor="channels" hint="e.g. Website popup only" error={errors.channels?.message}>
            <Input id="channels" aria-invalid={!!errors.channels} {...register("channels")} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" htmlFor="startDate" error={errors.startDate?.message}>
            <Input id="startDate" type="date" aria-invalid={!!errors.startDate} {...register("startDate")} />
          </Field>
          <Field label="End date" htmlFor="endDate" error={errors.endDate?.message}>
            <Input id="endDate" type="date" aria-invalid={!!errors.endDate} {...register("endDate")} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Redemptions" htmlFor="redemptions" error={errors.redemptions?.message}>
            <Input id="redemptions" aria-invalid={!!errors.redemptions} {...register("redemptions")} />
          </Field>
          <Field label="Redemption method" htmlFor="redemptionMethod" hint="e.g. Online order via Innowi" error={errors.redemptionMethod?.message}>
            <Input id="redemptionMethod" aria-invalid={!!errors.redemptionMethod} {...register("redemptionMethod")} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Approval owner" htmlFor="approvalOwner" error={errors.approvalOwner?.message}>
            <Input id="approvalOwner" aria-invalid={!!errors.approvalOwner} {...register("approvalOwner")} />
          </Field>
          <Field label="Staff briefed?" htmlFor="staffBriefed" error={errors.staffBriefed?.message}>
            <Select id="staffBriefed" aria-invalid={!!errors.staffBriefed} {...register("staffBriefed")}>
              <option value="">Select…</option>
              {YES_NO.map((v) => (
                <option key={v} value={v}>
                  {yesNoLabels[v]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Blackout dates" htmlFor="blackoutDates" error={errors.blackoutDates?.message}>
          <Input id="blackoutDates" aria-invalid={!!errors.blackoutDates} {...register("blackoutDates")} />
        </Field>

        <Field label="Notes" htmlFor="notes" error={errors.notes?.message}>
          <Textarea id="notes" rows={3} aria-invalid={!!errors.notes} {...register("notes")} />
        </Field>
      </form>
    </FormDrawer>
  );
}
