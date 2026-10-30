"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Drawer, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { WEBSITE_CONTENT_STEPS, WEBSITE_FORM_STEPS } from "../data/website-form-steps";
import {
  clearDraft,
  createWebsite,
  readDraft,
  updateWebsite,
  writeDraft,
} from "../data/websites-store";
import {
  blankRow,
  getRows,
  getString,
  setAt,
  stepErrorMap,
  stepProblems,
  withDefaults,
} from "../lib/website-values";
import type { Website, WebsiteRepeat, WebsiteValues } from "../types";
import { WebsiteFormField } from "./website-form-field";
import { WebsiteFormStepper, type StepState } from "./website-form-stepper";
import { WebsiteRepeatSection } from "./website-repeat-section";
import { WebsiteReviewStep } from "./website-review-step";

const LAST_INDEX = WEBSITE_FORM_STEPS.length - 1;

interface WebsiteFormDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing an existing record; absent creates a new one. */
  website?: Website;
}

/**
 * The website intake questionnaire, in a side sheet.
 *
 * Seven content steps plus a review page, driven entirely by the schema in
 * `data/website-form-steps.ts`. A step's errors stay hidden until you try to
 * move past it, so the form doesn't turn red before you've typed anything.
 * New (unsaved) answers autosave to a local draft, so closing the drawer
 * half-way doesn't lose the work.
 */
export function WebsiteFormDrawer({ open, onClose, website }: WebsiteFormDrawerProps) {
  const { toast } = useToast();
  const editing = Boolean(website);

  const [values, setValues] = useState<WebsiteValues>(() => withDefaults());
  const [current, setCurrent] = useState(0);
  /** Steps the user has tried to leave — only these show their errors. */
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const [savedNote, setSavedNote] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset whenever the drawer opens: an existing record loads its answers, a
  // new one picks up the autosaved draft (if any).
  useEffect(() => {
    if (!open) return;
    setValues(withDefaults(website ? website.values : (readDraft() ?? {})));
    setCurrent(0);
    setAttempted({});
    setSavedNote(false);
  }, [open, website]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

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

  const autosave = useCallback(
    (next: WebsiteValues) => {
      if (editing) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        writeDraft(next);
        setSavedNote(true);
        setTimeout(() => setSavedNote(false), 1400);
      }, 400);
    },
    [editing],
  );

  const handleChange = useCallback(
    (path: string, value: string) => {
      setValues((prev) => {
        const next = setAt(prev, path, value);
        autosave(next);
        return next;
      });
    },
    [autosave],
  );

  const handleAddRow = useCallback(
    (key: string) => {
      const repeat = findRepeat(key);
      if (!repeat) return;
      setValues((prev) => {
        const next = setAt(prev, key, [...getRows(prev, key), blankRow(repeat)]);
        autosave(next);
        return next;
      });
    },
    [autosave],
  );

  const handleRemoveRow = useCallback(
    (key: string, index: number) => {
      setValues((prev) => {
        const next = setAt(prev, key, getRows(prev, key).filter((_row, i) => i !== index));
        autosave(next);
        return next;
      });
    },
    [autosave],
  );

  const goTo = useCallback((index: number) => {
    setCurrent(Math.max(0, Math.min(LAST_INDEX, index)));
  }, []);

  /* --------------------------------------------------------------- submit */

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

  const save = (kind: "draft" | "submit") => {
    const status = kind === "draft" ? "in_creation" : "under_review";
    const name = getString(values, "business.name").trim() || "Untitled website";

    if (website) {
      updateWebsite(website.id, values, kind === "draft" ? website.status : status);
      toast({ variant: "success", title: "Website updated", description: name });
    } else {
      createWebsite(values, status);
      clearDraft();
      toast({
        variant: "success",
        title: kind === "draft" ? "Draft saved" : "Website created",
        description: name,
      });
    }
    onClose();
  };

  /* --------------------------------------------------------------- render */

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="3xl"
      title={editing ? `Edit ${website?.name}` : "New website"}
      description="Tell us about the business and we'll build the site around these answers."
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => goTo(current - 1)} disabled={current === 0}>
            <ChevronLeft className="size-4" />
            Back
          </Button>

          <span
            aria-live="polite"
            className={cn(
              "text-xs text-muted-foreground transition-opacity",
              savedNote ? "opacity-100" : "opacity-0",
            )}
          >
            Draft saved
          </span>

          <span className="flex-1" />

          <Button variant="outline" onClick={() => save("draft")}>
            Save draft
          </Button>
          <Button variant="default" onClick={handleNext}>
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
      {/* Progress rail — sticks to the top of the scrolling body. */}
      <div className="sticky top-0 z-[2] -mx-5 -mt-4 overflow-x-auto border-b border-border bg-card px-5 pb-3 pt-4">
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

      <div className="mt-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
          <p className="mt-0.5 text-table text-muted-foreground">{step.description}</p>
        </div>
        <span className="shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">
          Step {current + 1} of {WEBSITE_FORM_STEPS.length}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
        {step.review ? (
          <div className="sm:col-span-2">
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
              />
            );
          })
        )}
      </div>
    </Drawer>
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
