"use client";

import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, ErrorState, Field, Input, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { useCateringProfile, useUpsertCateringProfile } from "@/features/merchants/api";
import { YES_NO } from "@/features/merchants/types/enums";
import { yesNo as yesNoLabels } from "@/lib/enums";
import { isApiError } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import {
  cateringProfileSchema,
  cateringProfileDefaults,
  cateringProfileToFormValues,
  toUpsertCateringProfileInput,
  type CateringProfileFormValues,
} from "@/features/merchants/schemas/catering-profile.schema";

const FORM_ID = "catering-profile-form";

/**
 * Catering tab (route: /merchants/[merchantId]/catering). The catering profile
 * is 1:1 with the merchant, so this is a single always-visible form card: it
 * seeds from `useCateringProfile` (all-null with `exists: false` before the
 * first save) and PATCHes only the changed fields via `useUpsertCateringProfile`.
 */
export function CateringProfilePanel({ merchantId }: { merchantId: string }) {
  const { toast } = useToast();
  const { data: profile, isPending, isError, error, refetch } = useCateringProfile(merchantId);
  const upsert = useUpsertCateringProfile();
  // Keyed by merchant so a merchantId change re-seeds instead of showing stale values.
  const seededRef = useRef<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, dirtyFields, isDirty },
  } = useForm<CateringProfileFormValues>({
    resolver: zodResolver(cateringProfileSchema),
    defaultValues: cateringProfileDefaults,
    mode: "onBlur",
  });

  // Seed once the profile has loaded (reset clears the dirty state so
  // `dirtyFields` then reflects only the user's own edits).
  useEffect(() => {
    if (profile && seededRef.current !== merchantId) {
      seededRef.current = merchantId;
      reset(cateringProfileToFormValues(profile));
    }
  }, [profile, merchantId, reset]);

  const onSubmit = handleSubmit((values) => {
    const input = toUpsertCateringProfileInput(values, dirtyFields);

    if (Object.keys(input).length === 0) {
      toast({ variant: "info", title: "No changes to save" });
      return;
    }

    upsert.mutate(
      { merchantId, input },
      {
        onSuccess: (saved) => {
          toast({ variant: "success", title: "Catering profile saved" });
          reset(cateringProfileToFormValues(saved));
        },
        onError: (err) => {
          toast({
            variant: "error",
            title: "Couldn't save catering profile",
            description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
          });
        },
      },
    );
  });

  const saving = upsert.isPending;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-6 text-foreground">Catering</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            Whether the merchant caters, how leads come in, and what to promise.
          </p>
        </div>
        {profile &&
          (profile.exists && profile.updatedAt ? (
            <span className="text-xs text-muted-foreground">Last updated {formatDate(profile.updatedAt)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">Nothing saved yet — fill in what you know and save.</span>
          ))}
      </div>

      {isError ? (
        <Card>
          <ErrorState title="Couldn't load catering profile" error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <CateringProfileSkeleton />
      ) : (
        <Card>
          <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-5 p-[18px]">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Catering offered?" htmlFor="offered" error={errors.offered?.message}>
                <Select id="offered" aria-invalid={!!errors.offered} {...register("offered")}>
                  <option value="">Not set</option>
                  {YES_NO.map((v) => (
                    <option key={v} value={v}>
                      {yesNoLabels[v]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Minimum order" htmlFor="minOrder" error={errors.minOrder?.message}>
                <Input
                  id="minOrder"
                  placeholder="e.g. $250 or 10 guests, 48h notice"
                  aria-invalid={!!errors.minOrder}
                  {...register("minOrder")}
                />
              </Field>
            </div>

            <Field label="Catering contact" htmlFor="contact" hint="Who handles catering enquiries." error={errors.contact?.message}>
              <Input
                id="contact"
                placeholder="e.g. Maria (GM) — catering@trattoria.com, +1 555 010 2233"
                aria-invalid={!!errors.contact}
                {...register("contact")}
              />
            </Field>

            <Field label="Lead flow" htmlFor="leadFlow" hint="How a catering enquiry reaches the merchant and who follows up." error={errors.leadFlow?.message}>
              <Textarea
                id="leadFlow"
                placeholder="e.g. Website form → email to Maria → phone call within 24h"
                aria-invalid={!!errors.leadFlow}
                {...register("leadFlow")}
              />
            </Field>

            <Field label="Notes" htmlFor="notes" error={errors.notes?.message}>
              <Textarea
                id="notes"
                placeholder="e.g. Corporate lunches are the sweet spot; no weddings; delivery within 10 miles"
                aria-invalid={!!errors.notes}
                {...register("notes")}
              />
            </Field>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" type="button" disabled={!isDirty || saving} onClick={() => reset()}>
                Reset
              </Button>
              <Button variant="default" type="submit" form={FORM_ID} loading={saving} disabled={!isDirty}>
                Save changes
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function CateringProfileSkeleton() {
  return (
    <Card>
      <div className="flex flex-col gap-5 p-[18px]">
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-20 w-full rounded-md" />
        <Skeleton className="h-20 w-full rounded-md" />
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>
    </Card>
  );
}
