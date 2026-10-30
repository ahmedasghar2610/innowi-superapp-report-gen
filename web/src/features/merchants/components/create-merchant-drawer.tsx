"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Dialog, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { WebsiteFormStepper, type StepState } from "@/features/websites/components/website-form-stepper";
import { MERCHANT_FIELD_LABELS as LABELS, MERCHANT_FORM_STEPS as STEPS } from "./merchant-form-steps";
import { useCreateMerchant } from "@/features/merchants/api";
import { isInnowiOrderingLink } from "@/lib/api/resources/menu";
import { ACCOUNT_HEALTH, YES_NO } from "@/features/merchants/types/enums";
import { yesNo as yesNoLabels } from "@/lib/enums";
import { useAccountManagers } from "@/features/merchants/api";
import { useCan } from "@/features/auth/use-can";
import { fieldErrorsFrom, isApiError } from "@/lib/api/client";
import {
  createMerchantSchema,
  createMerchantDefaults,
  toCreateMerchantInput,
  type CreateMerchantFormValues,
} from "@/features/merchants/schemas/merchant.schema";

const FORM_ID = "create-merchant-form";
const LAST_INDEX = STEPS.length - 1;

/** DTO keys we can attach an inline field error to (must match the form names). */
const FIELD_NAMES: (keyof CreateMerchantFormValues)[] = [
  "restaurantName",
  "merchantCode",
  "legalName",
  "cuisineCategory",
  "websiteUrl",
  "websitePlatform",
  "onlineOrdering",
  "posSystem",
  "customerListSource",
  "googleAdsBudget",
  "metaAdsBudget",
  "businessGoals",
  "targetAudience",
  "slowDayparts",
  "seasonalPeaks",
  "dietaryCerts",
  "accountHealth",
  "accountManagerId",
  "nextAction",
  "openBlockers",
  "notes",
  "onboardingDate",
  "goLiveDate",
  "locationCount",
  "reportFrequency",
  "reportRecipients",
];

/**
 * Create Merchant form — a centered, stepped modal (route: /merchants/new,
 * usually shown as an intercepted modal over the list), laid out like the
 * website intake questionnaire. React Hook Form + Zod for client validation;
 * on submit it POSTs via `useCreateMerchant`, maps server 400 field errors and
 * the 409 duplicate-name conflict back onto the form, then navigates to the
 * new merchant's workspace on success.
 */
export function CreateMerchantDrawer() {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(true);
  const closingRef = useRef(false);

  const [current, setCurrent] = useState(0);
  /** Steps the user has tried to leave — only these show an error state on the rail. */
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const bodyRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    trigger,
    watch,
    formState: { errors },
  } = useForm<CreateMerchantFormValues>({
    resolver: zodResolver(createMerchantSchema),
    defaultValues: createMerchantDefaults,
    mode: "onBlur",
  });

  const createMerchant = useCreateMerchant();
  const { data: managers } = useAccountManagers();
  const canAssign = useCan()("accountManager.assign");

  useEffect(() => {
    // Focus the first field once the drawer has slid in.
    const t = setTimeout(() => setFocus("restaurantName"), 220);
    return () => clearTimeout(t);
  }, [setFocus]);

  /** Animate the drawer out, then leave the /new route. */
  function close() {
    if (closingRef.current) return;
    closingRef.current = true;
    setOpen(false);
    setTimeout(() => {
      if (window.history.length > 1) router.back();
      else router.push("/merchants");
    }, 200);
  }

  const goTo = (index: number) => {
    setCurrent(Math.max(0, Math.min(LAST_INDEX, index)));
    bodyRef.current?.parentElement?.scrollTo({ top: 0 });
  };

  const onSubmit = handleSubmit(
    (values) => {
    const input = toCreateMerchantInput(values);

    createMerchant.mutate(input, {
      onSuccess: (merchant) => {
        // An Innowi ordering link → the API is already loading the menu in the
        // background; land on the Menu tab so its loading display is visible.
        const loadingMenu = isInnowiOrderingLink(merchant.onlineOrdering);
        toast({
          variant: "success",
          title: "Merchant created",
          description: loadingMenu
            ? `${merchant.restaurantName} is ready — loading its menu and photos…`
            : `${merchant.restaurantName} is ready to profile.`,
        });
        closingRef.current = true;
        setOpen(false);
        const tab = loadingMenu ? "menu" : "overview";
        setTimeout(() => router.replace(`/merchants/${merchant.id}/${tab}`, { scroll: false }), 200);
      },
      onError: (error) => {
        if (isApiError(error) && error.isConflict) {
          goTo(0);
          setError(
            "merchantCode",
            { type: "server", message: "A merchant with this Merchant ID already exists." },
            { shouldFocus: true },
          );
          return;
        }

        if (isApiError(error) && error.isValidation) {
          const fieldErrors = fieldErrorsFrom(error, FIELD_NAMES as string[]);
          const entries = Object.entries(fieldErrors);
          if (entries.length > 0) {
            const firstStep = STEPS.findIndex((st) => st.fields.includes(entries[0][0] as keyof CreateMerchantFormValues));
            if (firstStep >= 0) goTo(firstStep);
            entries.forEach(([field, message], i) =>
              setError(field as keyof CreateMerchantFormValues, { type: "server", message }, i === 0 ? { shouldFocus: true } : undefined),
            );
            return;
          }
        }

        toast({
          variant: "error",
          title: "Couldn't create merchant",
          description: isApiError(error) ? error.messages[0] : "Something went wrong. Please try again.",
        });
      },
    });
    },
    (fieldErrors) => {
      // Client validation failed (e.g. "Create now" with an empty name from a
      // later step): jump to the first step that has a problem.
      const firstBad = (Object.keys(fieldErrors) as (keyof CreateMerchantFormValues)[])[0];
      const index = STEPS.findIndex((st) => st.fields.includes(firstBad));
      if (index >= 0) goTo(index);
    },
  );

  const busy = createMerchant.isPending;
  const step = STEPS[current];
  const values = watch();

  const handleNext = async () => {
    setAttempted((prev) => ({ ...prev, [step.id]: true }));
    const ok = await trigger(step.fields, { shouldFocus: true });
    if (!ok) return;
    goTo(current + 1);
  };

  const stepStates = useMemo(() => {
    const states: Record<string, StepState> = {};
    STEPS.forEach((s, i) => {
      const hasError = s.fields.some((f) => Boolean(errors[f]));
      if (i === current) states[s.id] = "current";
      else if (hasError) states[s.id] = "error";
      else if (attempted[s.id] || i < current) states[s.id] = "done";
      else states[s.id] = "todo";
    });
    return states;
  }, [attempted, current, errors]);

  const managerName = (id: string) => (managers ?? []).find((m) => m.id === id)?.name ?? id;
  const reviewRows = (Object.keys(LABELS) as (keyof CreateMerchantFormValues)[])
    .map((key) => {
      const raw = values[key];
      const v = raw === undefined || raw === null ? "" : String(raw).trim();
      return { key, label: LABELS[key], value: key === "accountManagerId" && v ? managerName(v) : v };
    })
    .filter((r) => r.value);

  return (
    <Dialog
      open={open}
      onClose={close}
      size="2xl"
      title="New merchant"
      description="Only the restaurant name is required — everything else can be filled in later on the Profile."
      dismissible={!busy}
      hideClose={busy}
      footerBordered
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button variant="ghost" type="button" onClick={() => goTo(current - 1)} disabled={current === 0 || busy}>
            <ChevronLeft className="size-4" />
            Back
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" type="button" onClick={close} disabled={busy}>
            Cancel
          </Button>
          {step.review ? (
            <Button variant="default" type="submit" form={FORM_ID} loading={busy}>
              <Check className="size-4" />
              Create merchant
            </Button>
          ) : (
            <>
              <Button variant="outline" type="submit" form={FORM_ID} loading={busy}>
                Create now
              </Button>
              <Button variant="default" type="button" onClick={handleNext} disabled={busy}>
                Next
                <ChevronRight className="size-4" />
              </Button>
            </>
          )}
        </div>
      }
    >
      <div ref={bodyRef}>
        {/* Progress rail — sticks to the top of the scrolling body. */}
        <div className="sticky top-0 z-[2] -mx-5 -mt-3 overflow-x-auto border-b border-border bg-card px-5 pb-3 pt-3">
          <WebsiteFormStepper
            steps={STEPS}
            current={current}
            states={stepStates}
            onSelect={(index) => {
              setAttempted((prev) => ({ ...prev, [step.id]: true }));
              goTo(index);
            }}
          />
        </div>

        <div className="mt-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
            <p className="mt-0.5 text-table text-muted-foreground">{step.description}</p>
          </div>
          <span className="shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">
            Step {current + 1} of {STEPS.length}
          </span>
        </div>

      {/* One form for every step: fields stay registered while hidden, so
          moving between steps never loses what was typed. */}
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="mt-4 flex min-h-[360px] flex-col gap-5">
        {step.review && (
          <section className="flex flex-col gap-3">
            {reviewRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing entered yet — at least the restaurant name is needed.</p>
            ) : (
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[180px_1fr]">
                {reviewRows.map((r) => (
                  <div key={r.key} className="contents">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="break-words text-foreground">{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {errors.restaurantName && (
              <p className="text-sm text-text-destructive">{errors.restaurantName.message}</p>
            )}
          </section>
        )}

        <Section title="Identity" hidden={step.id !== "identity"}>
          <Field label="Restaurant name" htmlFor="restaurantName" required error={errors.restaurantName?.message}>
            <Input
              id="restaurantName"
              placeholder="e.g. Bella Napoli Trattoria"
              aria-invalid={!!errors.restaurantName}
              {...register("restaurantName")}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Merchant ID" htmlFor="merchantCode" hint="The workbook's Merchant ID, e.g. M-001. Must be unique." error={errors.merchantCode?.message}>
              <Input id="merchantCode" placeholder="M-001" aria-invalid={!!errors.merchantCode} {...register("merchantCode")} />
            </Field>
            <Field label="Legal name" htmlFor="legalName" error={errors.legalName?.message}>
              <Input id="legalName" placeholder="Registered business name" aria-invalid={!!errors.legalName} {...register("legalName")} />
            </Field>
            <Field label="Cuisine category" htmlFor="cuisineCategory" error={errors.cuisineCategory?.message}>
              <Input id="cuisineCategory" placeholder="e.g. Italian" aria-invalid={!!errors.cuisineCategory} {...register("cuisineCategory")} />
            </Field>
          </div>

          <Field label="Account health" htmlFor="accountHealth" hint="Leave blank until the first review." error={errors.accountHealth?.message}>
            <Select id="accountHealth" aria-invalid={!!errors.accountHealth} {...register("accountHealth")}>
              <option value="">Not set</option>
              {ACCOUNT_HEALTH.map((h) => (
                <option key={h} value={h}>
                  {titleCase(h)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Account manager"
            htmlFor="accountManagerId"
            hint={canAssign ? "Who owns this relationship at Innowi." : "Only Marketing Managers and Admins can assign the account manager."}
            error={errors.accountManagerId?.message}
          >
            <Select id="accountManagerId" aria-invalid={!!errors.accountManagerId} disabled={!canAssign} {...register("accountManagerId")}>
              <option value="">Unassigned</option>
              {(managers ?? []).map((am) => (
                <option key={am.id} value={am.id}>
                  {am.name}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        <Section title="Web presence" hidden={step.id !== "web"}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Website URL" htmlFor="websiteUrl" hint="Include http:// or https://" error={errors.websiteUrl?.message}>
              <Input id="websiteUrl" inputMode="url" placeholder="https://example.com" aria-invalid={!!errors.websiteUrl} {...register("websiteUrl")} />
            </Field>
            <Field label="Website platform" htmlFor="websitePlatform" error={errors.websitePlatform?.message}>
              <Input id="websitePlatform" placeholder="e.g. Squarespace" aria-invalid={!!errors.websitePlatform} {...register("websitePlatform")} />
            </Field>
            <Field label="Online ordering" htmlFor="onlineOrdering" hint="Paste the Innowi ordering link (online-ordering.innowi.com/branch/…) and the menu loads automatically." error={errors.onlineOrdering?.message}>
              <Input id="onlineOrdering" placeholder="online-ordering.innowi.com/branch/…" aria-invalid={!!errors.onlineOrdering} {...register("onlineOrdering")} />
            </Field>
            <Field label="POS system" htmlFor="posSystem" error={errors.posSystem?.message}>
              <Input id="posSystem" placeholder="e.g. Square" aria-invalid={!!errors.posSystem} {...register("posSystem")} />
            </Field>
          </div>
        </Section>

        <Section title="Operations" hidden={step.id !== "operations"}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer list source" htmlFor="customerListSource" error={errors.customerListSource?.message}>
              <Input id="customerListSource" placeholder="e.g. POS export" aria-invalid={!!errors.customerListSource} {...register("customerListSource")} />
            </Field>
            <Field label="Alcohol license" htmlFor="alcoholLicense" error={errors.alcoholLicense?.message}>
              <Select id="alcoholLicense" aria-invalid={!!errors.alcoholLicense} {...register("alcoholLicense")}>
                <option value="">Not set</option>
                {YES_NO.map((v) => (
                  <option key={v} value={v}>
                    {yesNoLabels[v]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Number of locations" htmlFor="locationCount" error={errors.locationCount?.message}>
              <Input id="locationCount" type="number" min={0} step={1} inputMode="numeric" aria-invalid={!!errors.locationCount} {...register("locationCount")} />
            </Field>
            <Field label="Slow dayparts" htmlFor="slowDayparts" error={errors.slowDayparts?.message}>
              <Input id="slowDayparts" placeholder="e.g. Weekday afternoons" aria-invalid={!!errors.slowDayparts} {...register("slowDayparts")} />
            </Field>
            <Field label="Seasonal peaks" htmlFor="seasonalPeaks" error={errors.seasonalPeaks?.message}>
              <Input id="seasonalPeaks" placeholder="e.g. December holidays" aria-invalid={!!errors.seasonalPeaks} {...register("seasonalPeaks")} />
            </Field>
            <Field label="Dietary certifications" htmlFor="dietaryCerts" error={errors.dietaryCerts?.message}>
              <Input id="dietaryCerts" placeholder="e.g. Halal, Gluten-free" aria-invalid={!!errors.dietaryCerts} {...register("dietaryCerts")} />
            </Field>
          </div>
          <Field label="Target audience" htmlFor="targetAudience" error={errors.targetAudience?.message}>
            <Textarea id="targetAudience" placeholder="Who the merchant serves…" aria-invalid={!!errors.targetAudience} {...register("targetAudience")} />
          </Field>
          <Field label="Business goals" htmlFor="businessGoals" error={errors.businessGoals?.message}>
            <Textarea id="businessGoals" placeholder="What success looks like for them…" aria-invalid={!!errors.businessGoals} {...register("businessGoals")} />
          </Field>
        </Section>

        <Section title="Marketing budgets" hidden={step.id !== "budgets"}>
          <p className="-mt-1 text-xs leading-snug text-muted-foreground">
            Master fields (PRD Appendix C-6). The Google Ads and Meta Ads modules read these and
            define no budget of their own, so this is the only place either amount is set.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Google Ads budget"
              htmlFor="googleAdsBudget"
              hint="Monthly, in USD."
              error={errors.googleAdsBudget?.message}
            >
              <Input
                id="googleAdsBudget"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="0.00"
                aria-invalid={!!errors.googleAdsBudget}
                {...register("googleAdsBudget")}
              />
            </Field>
            <Field
              label="Meta Ads budget"
              htmlFor="metaAdsBudget"
              hint="Monthly, in USD."
              error={errors.metaAdsBudget?.message}
            >
              <Input
                id="metaAdsBudget"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="0.00"
                aria-invalid={!!errors.metaAdsBudget}
                {...register("metaAdsBudget")}
              />
            </Field>
          </div>
        </Section>

        <Section title="Lifecycle" hidden={step.id !== "lifecycle"}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Onboarding date" htmlFor="onboardingDate" error={errors.onboardingDate?.message}>
              <Input id="onboardingDate" type="date" aria-invalid={!!errors.onboardingDate} {...register("onboardingDate")} />
            </Field>
            <Field label="Go-live date" htmlFor="goLiveDate" error={errors.goLiveDate?.message}>
              <Input id="goLiveDate" type="date" aria-invalid={!!errors.goLiveDate} {...register("goLiveDate")} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Report frequency" htmlFor="reportFrequency" error={errors.reportFrequency?.message}>
              <Input id="reportFrequency" placeholder="e.g. Monthly" aria-invalid={!!errors.reportFrequency} {...register("reportFrequency")} />
            </Field>
            <Field label="Report recipients" htmlFor="reportRecipients" error={errors.reportRecipients?.message}>
              <Input id="reportRecipients" placeholder="Who receives the report" aria-invalid={!!errors.reportRecipients} {...register("reportRecipients")} />
            </Field>
          </div>
          <Field label="Next action" htmlFor="nextAction" error={errors.nextAction?.message}>
            <Input id="nextAction" placeholder="e.g. Collect brand assets" aria-invalid={!!errors.nextAction} {...register("nextAction")} />
          </Field>
          <Field label="Open blockers" htmlFor="openBlockers" error={errors.openBlockers?.message}>
            <Textarea id="openBlockers" placeholder="Anything holding onboarding up…" aria-invalid={!!errors.openBlockers} {...register("openBlockers")} />
          </Field>
          <Field label="Notes" htmlFor="notes" error={errors.notes?.message}>
            <Textarea id="notes" placeholder="Internal notes…" aria-invalid={!!errors.notes} {...register("notes")} />
          </Field>
        </Section>
      </form>
      </div>
    </Dialog>
  );
}

/** A step's fields. Hidden (not unmounted) when it isn't the current step. */
function Section({ title, hidden, children }: { title: string; hidden?: boolean; children: React.ReactNode }) {
  return (
    <section className={hidden ? "hidden" : "flex flex-col gap-4"} aria-hidden={hidden || undefined}>
      <h3 className="sr-only">{title}</h3>
      {children}
    </section>
  );
}

function titleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
