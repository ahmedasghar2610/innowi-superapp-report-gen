"use client";

import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, ErrorState, Field, Input, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { useBrandProfile, useUpsertBrandProfile } from "@/features/merchants/api";
import { YES_NO } from "@/features/merchants/types/enums";
import { yesNo as yesNoLabels } from "@/lib/enums";
import { isApiError } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { BrandAssetsSection } from "./brand-assets-section";
import {
  brandProfileSchema,
  brandProfileDefaults,
  brandProfileToFormValues,
  toUpsertBrandProfileInput,
  type BrandProfileFormValues,
} from "@/features/merchants/schemas/brand-profile.schema";

const FORM_ID = "brand-profile-form";

/**
 * Brand tab (route: /merchants/[merchantId]/brand). The brand profile is 1:1
 * with the merchant, so this is a single always-visible form card rather than
 * a list + drawer: it seeds from `useBrandProfile` (which returns all-null
 * values with `exists: false` before the first save) and PATCHes only the
 * changed fields via `useUpsertBrandProfile`.
 */
export function BrandProfilePanel({ merchantId }: { merchantId: string }) {
  const { toast } = useToast();
  const { data: profile, isPending, isError, error, refetch } = useBrandProfile(merchantId);
  const upsert = useUpsertBrandProfile();
  // Keyed by merchant so a merchantId change re-seeds instead of showing stale values.
  const seededRef = useRef<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, dirtyFields, isDirty },
  } = useForm<BrandProfileFormValues>({
    resolver: zodResolver(brandProfileSchema),
    defaultValues: brandProfileDefaults,
    mode: "onBlur",
  });

  // Seed once the profile has loaded (reset clears the dirty state so
  // `dirtyFields` then reflects only the user's own edits).
  useEffect(() => {
    if (profile && seededRef.current !== merchantId) {
      seededRef.current = merchantId;
      reset(brandProfileToFormValues(profile));
    }
  }, [profile, merchantId, reset]);

  const onSubmit = handleSubmit((values) => {
    const input = toUpsertBrandProfileInput(values, dirtyFields);

    if (Object.keys(input).length === 0) {
      toast({ variant: "info", title: "No changes to save" });
      return;
    }

    upsert.mutate(
      { merchantId, input },
      {
        onSuccess: (saved) => {
          toast({ variant: "success", title: "Brand profile saved" });
          reset(brandProfileToFormValues(saved));
        },
        onError: (err) => {
          toast({
            variant: "error",
            title: "Couldn't save brand profile",
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
          <h2 className="text-base font-semibold leading-6 text-foreground">Brand profile</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            The brand rules every creative must follow — colours, fonts, tone, and what never to say.
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
          <ErrorState title="Couldn't load brand profile" error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <BrandProfileSkeleton />
      ) : (
        <Card>
          <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-6 p-[18px]">
            <Section title="Identity">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vector logo available?" htmlFor="logoVector" error={errors.logoVector?.message}>
                  <Select id="logoVector" aria-invalid={!!errors.logoVector} {...register("logoVector")}>
                    <option value="">Not set</option>
                    {YES_NO.map((v) => (
                      <option key={v} value={v}>
                        {yesNoLabels[v]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Photo library status" htmlFor="photoLibraryStatus" error={errors.photoLibraryStatus?.message}>
                  <Input
                    id="photoLibraryStatus"
                    placeholder="e.g. 40 pro shots in Drive, needs new dessert photos"
                    aria-invalid={!!errors.photoLibraryStatus}
                    {...register("photoLibraryStatus")}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Brand colours" htmlFor="brandColors" hint="Name and hex, one per line." error={errors.brandColors?.message}>
                  <Textarea
                    id="brandColors"
                    placeholder={"Red-#B40314\nCream-#F6EFE4"}
                    aria-invalid={!!errors.brandColors}
                    {...register("brandColors")}
                  />
                </Field>
                <Field label="Brand fonts" htmlFor="brandFonts" error={errors.brandFonts?.message}>
                  <Textarea
                    id="brandFonts"
                    placeholder={"Headings: Playfair Display\nBody: Lato"}
                    aria-invalid={!!errors.brandFonts}
                    {...register("brandFonts")}
                  />
                </Field>
              </div>
            </Section>

            <Section title="Menu & dishes">
              <Field label="Menu format" htmlFor="menuFormat" error={errors.menuFormat?.message}>
                <Input
                  id="menuFormat"
                  placeholder="e.g. PDF on website, updated seasonally"
                  aria-invalid={!!errors.menuFormat}
                  {...register("menuFormat")}
                />
              </Field>
              <Field label="Signature dishes" htmlFor="signatureDishes" hint="The dishes to lead with in creative." error={errors.signatureDishes?.message}>
                <Textarea
                  id="signatureDishes"
                  placeholder="e.g. Wood-fired margherita, lamb shank tagine, tiramisu"
                  aria-invalid={!!errors.signatureDishes}
                  {...register("signatureDishes")}
                />
              </Field>
            </Section>

            <Section title="Voice">
              <Field label="Tone of voice" htmlFor="toneOfVoice" error={errors.toneOfVoice?.message}>
                <Input
                  id="toneOfVoice"
                  placeholder="Warm, family, community-first"
                  aria-invalid={!!errors.toneOfVoice}
                  {...register("toneOfVoice")}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Do not say" htmlFor="doNotSay" hint="Words and claims that must never appear." error={errors.doNotSay?.message}>
                  <Textarea
                    id="doNotSay"
                    placeholder={"\"Cheap\", \"fast food\"\nNo discount language on signature dishes"}
                    aria-invalid={!!errors.doNotSay}
                    {...register("doNotSay")}
                  />
                </Field>
                <Field label="Content restrictions" htmlFor="contentRestrictions" error={errors.contentRestrictions?.message}>
                  <Textarea
                    id="contentRestrictions"
                    placeholder="e.g. No alcohol imagery, no stock photos of food, owner approves all video"
                    aria-invalid={!!errors.contentRestrictions}
                    {...register("contentRestrictions")}
                  />
                </Field>
              </div>
            </Section>

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

      <BrandAssetsSection merchantId={merchantId} />
    </div>
  );
}

function BrandProfileSkeleton() {
  return (
    <Card>
      <div className="flex flex-col gap-6 p-[18px]">
        {Array.from({ length: 3 }).map((_, s) => (
          <div key={s} className="flex flex-col gap-4">
            <Skeleton className="h-3 w-24" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
            <Skeleton className="h-20 w-full rounded-md" />
          </div>
        ))}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
