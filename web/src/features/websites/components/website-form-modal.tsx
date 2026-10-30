"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Building2, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { WEBSITE_CONTENT_STEPS, WEBSITE_FORM_STEPS } from "../data/website-form-steps";
import { useCreateMerchantFromWebsite, useCreateWebsite, useUpdateWebsite } from "../api/websites.queries";
import {
  blankRow,
  getRows,
  getString,
  setAt,
  stepErrorMap,
  stepProblems,
  withDefaults,
} from "../lib/website-values";
import type { MerchantChoice, Website, WebsiteRepeat, WebsiteStatus, WebsiteValues } from "../types";
import { MerchantPicker } from "./merchant-picker";
import { WebsiteFormField } from "./website-form-field";
import { WebsiteFormStepper, type StepState } from "./website-form-stepper";
import { WebsiteRepeatSection } from "./website-repeat-section";
import { WebsiteReviewStep } from "./website-review-step";
import { WebsiteOpenLink, WebsiteStatusControl } from "./website-status-control";

/** Statuses a site is still being built in — submitting moves them to Under review. */
const BUILDING: WebsiteStatus[] = ["not_started", "in_creation", "content_required", "content_map_required"];

const LAST_INDEX = WEBSITE_FORM_STEPS.length - 1;

interface WebsiteFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing an existing record; absent creates a new one. */
  website?: Website;
  /**
   * Answers to start a *new* website from — the .docx import hands its result
   * over here so it can be checked and saved through the normal form.
   */
  initialValues?: WebsiteValues;
  /** Step to open on (the import opens straight on the review page). */
  initialStep?: "first" | "review";
  /**
   * For a *new* site: how it relates to a merchant. Pre-set by the workspace
   * ("this merchant") or the .docx import; otherwise chosen in the form.
   */
  initialMerchant?: MerchantChoice;
  /** Keys the Profile supplies for a pre-filled new site (locked in the form). */
  initialProfileFields?: string[];
  /** Hide the merchant question (the workspace already knows the merchant). */
  merchantFixed?: boolean;
}

/**
 * The website intake questionnaire, in a centered modal.
 *
 * Eight content steps plus a review page, driven entirely by the schema in
 * `data/website-form-steps.ts`. A step's errors stay hidden until you try to
 * move past it, so the form doesn't turn red before you've typed anything.
 *
 * Answers are persisted by the Website Intake API: "Save draft" writes what
 * exists so far (a new site is saved `in_creation`, so a part-filled form can
 * be picked up later), and the review step's button saves it `under_review`.
 *
 * When editing, "Visit site" opens the published page — the site template
 * renders it from this same record, so it always shows the last save.
 */
export function WebsiteFormModal({
  open,
  onClose,
  website,
  initialValues,
  initialStep = "first",
  initialMerchant,
  initialProfileFields,
  merchantFixed = false,
}: WebsiteFormModalProps) {
  const { toast } = useToast();
  const editing = Boolean(website);
  const can = useCan();
  const canCreateMerchant = can("merchant.create");

  const create = useCreateWebsite();
  const update = useUpdateWebsite();
  const createMerchant = useCreateMerchantFromWebsite();
  const busy = create.isPending || update.isPending || createMerchant.isPending;

  // Merchant this (new) site will belong to. Editing an existing site shows
  // its link read-only; changing it is done from the list ("Link to merchant").
  const [merchant, setMerchant] = useState<MerchantChoice>({ mode: "none" });
  const linkedName = website?.merchantName ?? (merchant.mode === "existing" ? merchant.merchantName : undefined);
  const linkedId = website?.merchantId ?? (merchant.mode === "existing" ? merchant.merchantId : undefined);
  // Fields the Profile governs: locked here, edited on the Profile.
  const lockedKeys = useMemo(
    () => new Set(website?.merchantId ? (website.profileFields ?? []) : merchant.mode === "existing" ? (initialProfileFields ?? []) : []),
    [website, merchant, initialProfileFields],
  );

  const [values, setValues] = useState<WebsiteValues>(() => withDefaults());
  const [current, setCurrent] = useState(0);
  /** Steps the user has tried to leave — only these show their errors. */
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const bodyRef = useRef<HTMLDivElement>(null);

  // Reset whenever the dialog opens, loading the record's answers when editing.
  useEffect(() => {
    if (!open) return;
    setValues(withDefaults(website?.values ?? initialValues ?? {}));
    setCurrent(initialStep === "review" ? LAST_INDEX : 0);
    setAttempted({});
    setMerchant(initialMerchant ?? { mode: "none" });
  }, [open, website, initialValues, initialStep, initialMerchant]);

  const step = WEBSITE_FORM_STEPS[current];

  const errors = useMemo(
    () => (attempted[step.id] ? stepErrorMap(step, values) : {}),
    [attempted, step, values],
  );

  const stepStates = useMemo(() => {
    const states: Record<string, StepState> = {};
    for (let i = 0; i < WEBSITE_FORM_STEPS.length; i++) {
      const s = WEBSITE_FORM_STEPS[i];
      if (i === current) states[s.id] = "current";
      else if (s.review) states[s.id] = "todo";
      else if (attempted[s.id] && stepProblems(s, values).length) states[s.id] = "error";
      else if (attempted[s.id]) states[s.id] = "done";
      else states[s.id] = "todo";
    }
    return states;
  }, [attempted, current, values]);

  /* ------------------------------------------------------------- mutators */

  const handleChange = useCallback((path: string, value: string) => {
    setValues((prev) => setAt(prev, path, value));
  }, []);

  const handleAddRow = useCallback((key: string) => {
    const repeat = findRepeat(key);
    if (!repeat) return;
    setValues((prev) => setAt(prev, key, [...getRows(prev, key), blankRow(repeat)]));
  }, []);

  const handleRemoveRow = useCallback((key: string, index: number) => {
    setValues((prev) => setAt(prev, key, getRows(prev, key).filter((_row, i) => i !== index)));
  }, []);

  /** Moving between steps starts the new one at the top of the scroll area. */
  const goTo = useCallback((index: number) => {
    setCurrent(Math.max(0, Math.min(LAST_INDEX, index)));
    bodyRef.current?.parentElement?.scrollTo({ top: 0 });
  }, []);

  /* --------------------------------------------------------------- submit */

  /**
   * "draft" = Save draft, "submit" = the review step's button. A new site
   * starts In creation (draft) or Under review (submit). An existing site keeps
   * its status — except that submitting one still being built moves it to
   * Under review. Publishing is done with the status control, never here.
   */
  const save = (kind: "draft" | "submit") => {
    const name = getString(values, "business.name").trim() || "Untitled website";

    const onError = (err: { messages: string[] }) =>
      toast({
        variant: "error",
        title: "Couldn't save the website",
        description: err.messages.join(" · "),
      });

    if (website) {
      const nextStatus: WebsiteStatus =
        kind === "submit" && BUILDING.includes(website.status) ? "under_review" : website.status;
      update.mutate(
        { id: website.id, input: { values, status: nextStatus } },
        {
          onSuccess: () => {
            toast({ variant: "success", title: "Website updated", description: name });
            onClose();
          },
          onError,
        },
      );
      return;
    }

    const done = (extra?: string) => {
      toast({
        variant: "success",
        title: kind === "draft" ? "Draft saved" : "Website created",
        description: extra ? `${name} — ${extra}` : name,
      });
      onClose();
    };

    create.mutate(
      { values, status: kind === "draft" ? "in_creation" : "under_review", merchantId: merchant.mode === "existing" ? merchant.merchantId : undefined },
      {
        onSuccess: (created) => {
          if (merchant.mode !== "new") {
            done(merchant.mode === "existing" ? `linked to ${merchant.merchantName}` : undefined);
            return;
          }
          // "Create a new merchant from these details": the site is saved, now
          // build the merchant from it and link. A failure here leaves an
          // unassigned site that can be linked from the list.
          createMerchant.mutate(
            { id: created.id },
            {
              onSuccess: (linked) => done(`merchant "${linked.merchantName}" created`),
              onError: (err) => {
                toast({
                  variant: "warning",
                  title: "Website saved, but the merchant wasn't created",
                  description: `${err.messages.join(" · ")} — link it from the list.`,
                });
                onClose();
              },
            },
          );
        },
        onError,
      },
    );
  };

  const handleNext = () => {
    setAttempted((prev) => ({ ...prev, [step.id]: true }));

    if (step.review) {
      const missing = WEBSITE_CONTENT_STEPS.reduce((n, s) => n + stepProblems(s, values).length, 0);
      if (missing) {
        setAttempted(Object.fromEntries(WEBSITE_FORM_STEPS.map((s) => [s.id, true])));
        toast({
          variant: "warning",
          title: `${missing} required ${missing === 1 ? "field" : "fields"} still empty`,
          description: "Use the Edit links to jump to what's missing.",
        });
        return;
      }
      save("submit");
      return;
    }

    const problems = stepProblems(step, values);
    if (problems.length) {
      toast({
        variant: "warning",
        title: `${problems.length} ${problems.length === 1 ? "field needs" : "fields need"} attention`,
      });
      return;
    }

    goTo(current + 1);
  };

  /* --------------------------------------------------------------- render */

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="2xl"
      title={editing ? `Edit ${website?.name}` : "New website"}
      description="Tell us about the business and we'll build the site around these answers."
      dismissible={!busy}
      hideClose={busy}
      footerBordered
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => goTo(current - 1)} disabled={current === 0 || busy}>
            <ChevronLeft className="size-4" />
            Back
          </Button>

          {/* Only an existing record has a published page to look at. */}
          {website && (
            <span className="inline-flex items-center gap-1.5">
              <WebsiteStatusControl website={website} />
              <WebsiteOpenLink website={website} />
            </span>
          )}

          <span className="flex-1" />

          <Button variant="outline" onClick={() => save("draft")} loading={update.isPending || create.isPending}>
            Save draft
          </Button>
          <Button variant="default" onClick={handleNext} disabled={busy}>
            {step.review ? (
              <>
                <Check className="size-4" />
                {editing ? "Save website" : "Create website"}
              </>
            ) : (
              <>
                Next
                <ChevronRight className="size-4" />
              </>
            )}
          </Button>
        </div>
      }
    >
      <div ref={bodyRef}>
        {/* Progress rail — sticks to the top of the scrolling body. */}
        <div className="sticky top-0 z-[2] -mx-5 -mt-3 overflow-x-auto border-b border-border bg-card px-5 pb-3 pt-3">
          <WebsiteFormStepper
            steps={WEBSITE_FORM_STEPS}
            current={current}
            states={stepStates}
            onSelect={(index) => {
              setAttempted((prev) => ({ ...prev, [step.id]: true }));
              goTo(index);
            }}
          />
        </div>

        {linkedId && (
          <p className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-table text-muted-foreground">
            <Building2 className="size-4 shrink-0 text-primary" aria-hidden />
            <span>
              Belongs to{" "}
              <Link href={`/merchants/${linkedId}/overview`} className="font-medium text-foreground hover:underline">
                {linkedName}
              </Link>
              {lockedKeys.size > 0 &&
                " — business name, contact, address and hours come from its Profile and are read-only here. Change them on the Profile, or on this website only with the visual editor."}
            </span>
          </p>
        )}

        {website?.editorUpdatedAt &&
          (website.editorBound ? (
            <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-table text-muted-foreground">
              This site is also edited in its visual editor. Text, links, images and list items you change here still
              update the live page, and edits made there show up in this form. Layout and styling from the visual
              editor are kept.
            </p>
          ) : (
            <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-table text-muted-foreground">
              This site was edited in its visual editor before form syncing existed, so changes here won&apos;t
              appear on the live page. Rebuild it from the form once (key icon in the list) to switch it over — after
              that both editors stay in sync.
            </p>
          ))}

        <div className="mt-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
            <p className="mt-0.5 text-table text-muted-foreground">{step.description}</p>
          </div>
          <span className="shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">
            Step {current + 1} of {WEBSITE_FORM_STEPS.length}
          </span>
        </div>

        {/* A floor on the height keeps the dialog from resizing between steps. */}
        <div className="mt-4 grid min-h-[360px] grid-cols-1 content-start gap-x-4 gap-y-3.5 sm:grid-cols-2">
          {step.review ? (
            <div className="flex flex-col gap-5 sm:col-span-2">
              {!editing && !merchantFixed && (
                <section className="rounded-md border border-border p-3">
                  <h4 className="text-sm font-semibold text-foreground">Merchant</h4>
                  <p className="mb-2 mt-0.5 text-table text-muted-foreground">
                    Which merchant does this website belong to?
                  </p>
                  <MerchantPicker value={merchant} onChange={setMerchant} allowNew={canCreateMerchant} disabled={busy} />
                </section>
              )}
              <WebsiteReviewStep
                values={values}
                onEditStep={(stepId) => goTo(WEBSITE_FORM_STEPS.findIndex((s) => s.id === stepId))}
              />
            </div>
          ) : (
            step.entries.map((entry, i) => {
              if (entry.kind === "group") {
                return (
                  <p
                    key={`group-${i}`}
                    className="mt-1.5 border-t border-border pt-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:col-span-2"
                  >
                    {entry.label}
                  </p>
                );
              }

              if (entry.kind === "repeat") {
                return (
                  <WebsiteRepeatSection
                    key={entry.key}
                    repeat={entry}
                    rows={getRows(values, entry.key)}
                    errors={errors}
                    onChange={handleChange}
                    onAddRow={handleAddRow}
                    onRemoveRow={handleRemoveRow}
                    onNotice={(message) => toast({ variant: "warning", title: message })}
                  />
                );
              }

              return (
                <WebsiteFormField
                  key={entry.key}
                  field={entry}
                  path={entry.key}
                  value={getString(values, entry.key)}
                  error={errors[entry.key]}
                  onChange={handleChange}
                  onNotice={(message) => toast({ variant: "warning", title: message })}
                  locked={lockedKeys.has(entry.key)}
                  profileValue={website?.siteOnlyFields?.[entry.key]}
                />
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** Look up a repeatable section by its dotted key. */
function findRepeat(key: string): WebsiteRepeat | undefined {
  for (const step of WEBSITE_FORM_STEPS) {
    for (const entry of step.entries) {
      if (entry.kind === "repeat" && entry.key === key) return entry;
    }
  }
  return undefined;
}
