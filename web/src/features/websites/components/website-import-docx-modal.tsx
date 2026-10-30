"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  FileText,
  Loader2,
  Upload,
} from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { isApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { WEBSITE_FORM_STEPS } from "../data/website-form-steps";
import { websitesApi } from "../api/client";
import { useCreateMerchantFromWebsite, useCreateWebsite } from "../api/websites.queries";
import { getRows, getString, setAt, withDefaults } from "../lib/website-values";
import type { MerchantChoice, WebsiteDocxImport, WebsiteField, WebsiteFormStep, WebsiteValues } from "../types";
import { MerchantPicker } from "./merchant-picker";
import { WebsiteBulkImages } from "./website-bulk-images";
import { WebsiteFormField } from "./website-form-field";
import { WebsiteFormStepper, type StepState } from "./website-form-stepper";

/**
 * "Import from .docx" — start a website from a One-Page Website Content file.
 *
 *   1. Upload   the .docx is read by POST /websites/import-docx (nothing saved)
 *   2. Check    what was found, section by section, and anything missing
 *   3. Images   logo, section photos, one photo per dish, colours and fonts —
 *               or "Upload all images": a whole folder placed by file name
 *               (logo / hero / about / dish-01… / point-01…) plus brand.json
 *   4. Details  what a content file never carries (email, social links) → save
 *
 * The result is the same answer tree the normal form writes, so saving goes
 * through the same API call — or "Review in full form" hands it to
 * `WebsiteFormModal` to check every field before creating.
 */

const STEPS: WebsiteFormStep[] = [
  { id: "upload", label: "Upload", title: "Upload the content file", description: "", entries: [] },
  { id: "check", label: "Check", title: "What we found", description: "", entries: [] },
  { id: "images", label: "Images", title: "Images & brand", description: "", entries: [] },
  { id: "details", label: "Details", title: "Finishing details", description: "", entries: [] },
];

/** The sections a content file can have, in page order. */
const SECTIONS: { code: string; name: string; summary: (v: WebsiteValues) => string }[] = [
  { code: "G", name: "Search & navigation", summary: (v) => getString(v, "meta.title") },
  { code: "S1", name: "Hero", summary: (v) => getString(v, "hero.headline") },
  { code: "S2", name: "About", summary: (v) => getString(v, "about.heading") },
  {
    code: "S3",
    name: "Menu",
    summary: (v) => {
      const n = getRows(v, "offerings.items").length;
      return `${getString(v, "offerings.heading")} — ${n} ${n === 1 ? "dish" : "dishes"}`;
    },
  },
  {
    code: "S4",
    name: "Why choose us",
    summary: (v) => {
      const n = getRows(v, "social.points").length;
      return `${getString(v, "social.heading")} — ${n} ${n === 1 ? "point" : "points"}`;
    },
  },
  { code: "S5", name: "Catering", summary: (v) => getString(v, "catering.heading") },
  { code: "S6", name: "Reviews", summary: (v) => getString(v, "social.reviewsHeading") },
  { code: "S7", name: "Contact", summary: (v) => getString(v, "contact.heading") },
  { code: "S8", name: "Footer", summary: (v) => getString(v, "footer.about") },
];

/** Schema lookup, so the wizard renders exactly the controls the form uses. */
const FIELDS: Record<string, WebsiteField> = (() => {
  const out: Record<string, WebsiteField> = {};
  for (const step of WEBSITE_FORM_STEPS) {
    for (const entry of step.entries) {
      if (entry.kind === "field") out[entry.key] = entry;
      if (entry.kind === "repeat") for (const f of entry.fields) out[`${entry.key}.*.${f.key}`] = f;
    }
  }
  return out;
})();

function schemaField(key: string, overrides: Partial<WebsiteField> = {}): WebsiteField {
  const base = FIELDS[key.replace(/\.\d+\./, ".*.")];
  return { ...(base ?? { kind: "field", key, label: key, type: "text" }), ...overrides, key };
}

interface WebsiteImportDocxModalProps {
  open: boolean;
  onClose: () => void;
  /** "Review in full form" — hand the answers (and the merchant choice) over to the normal form. */
  onOpenInForm: (values: WebsiteValues, merchant: MerchantChoice) => void;
  /** Pre-set by the workspace ("this merchant"); hides the merchant question. */
  fixedMerchant?: MerchantChoice;
}

export function WebsiteImportDocxModal({ open, onClose, onOpenInForm, fixedMerchant }: WebsiteImportDocxModalProps) {
  const { toast } = useToast();
  const create = useCreateWebsite();
  const createMerchant = useCreateMerchantFromWebsite();
  const can = useCan();
  const canCreateMerchant = can("merchant.create");
  const [merchant, setMerchant] = useState<MerchantChoice>(fixedMerchant ?? { mode: "none" });

  const [current, setCurrent] = useState(0);
  const [result, setResult] = useState<WebsiteDocxImport | null>(null);
  const [values, setValues] = useState<WebsiteValues>({});
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [tried, setTried] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setCurrent(0);
    setResult(null);
    setValues({});
    setReadError("");
    setTried(false);
    // A file that names a business we don't have yet defaults to "new merchant".
    setMerchant(fixedMerchant ?? { mode: canCreateMerchant ? "new" : "none" });
  }, [open, fixedMerchant, canCreateMerchant]);

  const goTo = useCallback((index: number) => {
    setCurrent(Math.max(0, Math.min(STEPS.length - 1, index)));
    bodyRef.current?.parentElement?.scrollTo({ top: 0 });
  }, []);

  const handleChange = useCallback((path: string, value: string) => {
    setValues((prev) => setAt(prev, path, value));
  }, []);

  const notice = useCallback((message: string) => toast({ variant: "warning", title: message }), [toast]);

  /* ---------------------------------------------------------------- read */

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setReadError("Choose a Word .docx file. Older .doc files need re-saving as .docx first.");
      return;
    }
    setReading(true);
    setReadError("");
    try {
      const imported = await websitesApi.importDocx(file);
      setResult(imported);
      setValues(withDefaults(imported.values));
      goTo(1);
    } catch (err) {
      setReadError(isApiError(err) ? err.messages.join(" · ") : "The file couldn't be read.");
    } finally {
      setReading(false);
    }
  };

  /* ---------------------------------------------------------- validation */

  const email = getString(values, "business.email").trim();
  const emailProblem = !email
    ? "The content file has no email address — add one."
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? ""
      : "That doesn't look like an email address.";

  const save = () => {
    setTried(true);
    if (emailProblem) {
      toast({ variant: "warning", title: "Add the business email before saving" });
      return;
    }
    const name = getString(values, "business.name").trim() || "Untitled website";
    create.mutate(
      { values, status: "in_creation", merchantId: merchant.mode === "existing" ? merchant.merchantId : undefined },
      {
        onSuccess: (created) => {
          if (merchant.mode !== "new") {
            toast({
              variant: "success",
              title: "Website imported as a draft",
              description: merchant.mode === "existing" ? `${name} — linked to ${merchant.merchantName}` : name,
            });
            onClose();
            return;
          }
          createMerchant.mutate(
            { id: created.id },
            {
              onSuccess: (linked) =>
                (toast({
                  variant: "success",
                  title: "Website imported and merchant created",
                  description: `${name} → ${linked.merchantName}`,
                }),
                onClose()),
              onError: (err) =>
                (toast({
                  variant: "warning",
                  title: "Website saved, but the merchant wasn't created",
                  description: `${err.messages.join(" · ")} — link it from the list.`,
                }),
                onClose()),
            },
          );
        },
        onError: (err) =>
          toast({ variant: "error", title: "Couldn't save the website", description: err.messages.join(" · ") }),
      },
    );
  };

  const stepStates = useMemo(() => {
    const states: Record<string, StepState> = {};
    STEPS.forEach((s, i) => {
      states[s.id] = i === current ? "current" : i < current ? "done" : "todo";
    });
    if (tried && emailProblem && current !== 3) states.details = "error";
    return states;
  }, [current, tried, emailProblem]);

  const step = STEPS[current];
  const busy = reading || create.isPending || createMerchant.isPending;

  /* -------------------------------------------------------------- render */

  const field = (key: string, overrides: Partial<WebsiteField> = {}, error?: string) => (
    <WebsiteFormField
      key={key}
      field={schemaField(key, overrides)}
      path={key}
      value={getString(values, key)}
      error={error}
      onChange={handleChange}
      onNotice={notice}
    />
  );

  const group = (label: string, hint?: string) => (
    <div key={`g-${label}`} className="mt-1.5 border-t border-border pt-3.5 sm:col-span-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {hint && <p className="mt-1 text-table text-muted-foreground">{hint}</p>}
    </div>
  );

  const dishes = getRows(values, "offerings.items");
  const points = getRows(values, "social.points");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="2xl"
      title="Import website from .docx"
      description="Upload a One-Page Website Content file, add the images, and the site is ready to review."
      dismissible={!busy}
      hideClose={busy}
      footerBordered
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => goTo(current - 1)} disabled={current === 0 || busy}>
            <ChevronLeft className="size-4" />
            Back
          </Button>
          <span className="flex-1" />
          {current === 3 ? (
            <>
              <Button variant="outline" onClick={() => onOpenInForm(values, merchant)} disabled={busy}>
                Review in full form
              </Button>
              <Button variant="default" onClick={save} loading={create.isPending || createMerchant.isPending}>
                <Check className="size-4" />
                Save as draft
              </Button>
            </>
          ) : (
            <Button variant="default" onClick={() => goTo(current + 1)} disabled={busy || !result}>
              Next
              <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
      }
    >
      <div ref={bodyRef}>
        <div className="sticky top-0 z-[2] -mx-5 -mt-3 overflow-x-auto border-b border-border bg-card px-5 pb-3 pt-3">
          <WebsiteFormStepper
            steps={STEPS}
            current={current}
            states={stepStates}
            onSelect={(index) => {
              if (result || index === 0) goTo(index);
            }}
          />
        </div>

        <div className="mt-4 flex items-start gap-3">
          <h3 className="min-w-0 flex-1 text-base font-semibold text-foreground">{step.title}</h3>
          <span className="shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">
            Step {current + 1} of {STEPS.length}
          </span>
        </div>

        <div className="mt-4 min-h-[360px]">
          {/* ------------------------------------------------------ upload */}
          {current === 0 && (
            <div className="flex flex-col gap-3">
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void readFile(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors",
                  dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-muted/40",
                  reading && "pointer-events-none opacity-70",
                )}
              >
                {reading ? (
                  <Loader2 className="size-8 animate-spin text-primary" />
                ) : (
                  <Upload className="size-8 text-muted-foreground" />
                )}
                <span className="text-sm font-medium text-foreground">
                  {reading ? "Reading the file…" : "Drop the .docx here, or click to choose"}
                </span>
                <span className="max-w-md text-table text-muted-foreground">
                  A One-Page Website Content file: Part 2 with sections G, S1 Hero … S8 Footer. Parts 1 and 3
                  are ignored.
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  hidden
                  onChange={(e) => {
                    void readFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {readError && (
                <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-text-destructive">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  {readError}
                </p>
              )}
              {result && !reading && (
                <p className="flex items-center gap-2 text-table text-muted-foreground">
                  <FileText className="size-4" />
                  {result.fileName} is loaded. Choosing another file replaces everything imported from it.
                </p>
              )}
            </div>
          )}

          {/* ------------------------------------------------------- check */}
          {current === 1 && result && (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{getString(values, "business.name")}</p>
                <p className="mt-0.5 text-table text-muted-foreground">
                  {[getString(values, "business.address"), getString(values, "business.city")]
                    .filter(Boolean)
                    .join(", ")}
                  {getString(values, "business.phone") && ` · ${getString(values, "business.phone")}`}
                </p>
                <p className="mt-0.5 truncate text-table text-muted-foreground">
                  Order link: {getString(values, "orderUrl") || "—"}
                </p>
              </div>

              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SECTIONS.map((s) => {
                  const found = result.sections.includes(s.code);
                  const summary = found ? s.summary(values) : "";
                  return (
                    <li
                      key={s.code}
                      className={cn(
                        "flex items-start gap-2.5 rounded-md border px-3 py-2.5",
                        found ? "border-border" : "border-dashed border-border bg-muted/30",
                      )}
                    >
                      {found ? (
                        <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                      ) : (
                        <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          <span className="mr-1.5 text-xs text-muted-foreground">{s.code}</span>
                          {s.name}
                        </p>
                        <p className="line-clamp-2 text-table text-muted-foreground">
                          {found ? summary || "Found" : "Not in this file — left off the site"}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {result.warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                  <p className="mb-1 text-sm font-medium text-foreground">Worth a look</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-table text-muted-foreground">
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------------ images */}
          {current === 2 && (
            <div className="grid grid-cols-1 content-start gap-x-4 gap-y-3.5 sm:grid-cols-2">
              <WebsiteBulkImages
                dishNames={dishes.map((d) => String(d.name ?? ""))}
                pointTitles={points.map((p) => String(p.title ?? ""))}
                current={(path) => getString(values, path)}
                onApply={(changes) => setValues((prev) => changes.reduce((v, [path, value]) => setAt(v, path, value), prev))}
                disabled={busy}
              />
              {field("brand.logo")}
              {field("hero.image")}
              {field("hero.imageAlt")}
              {field("about.image")}
              {field("about.imageAlt")}

              {dishes.length > 0 &&
                group(
                  `Dish photos (${dishes.length})`,
                  "Optional. A dish without a photo shows a placeholder tile.",
                )}
              {dishes.map((dish, i) =>
                field(`offerings.items.${i}.image`, { label: dish.name || `Dish ${i + 1}`, fullWidth: false }),
              )}

              {points.length > 0 &&
                group("Selling point icons", "Optional. An emoji, or an uploaded icon image instead.")}
              {points.map((point, i) => (
                <div key={`point-${i}`} className="grid grid-cols-[88px_1fr] gap-2 sm:col-span-2">
                  {field(`social.points.${i}.emoji`, { label: "Emoji", hint: undefined, placeholder: "⭐" })}
                  {field(`social.points.${i}.icon`, { label: point.title || `Point ${i + 1}`, hint: undefined })}
                </div>
              ))}

              {group("Colours & fonts")}
              {field("brand.primary")}
              {field("brand.secondary")}
              {field("brand.accent")}
              {field("brand.textColor")}
              {field("brand.headingFont")}
              {field("brand.bodyFont")}
            </div>
          )}

          {/* ----------------------------------------------------- details */}
          {current === 3 && (
            <div className="grid grid-cols-1 content-start gap-x-4 gap-y-3.5 sm:grid-cols-2">
              {!fixedMerchant && (
                <section className="rounded-md border border-border p-3 sm:col-span-2">
                  <h4 className="text-sm font-semibold text-foreground">Merchant</h4>
                  <p className="mb-2 mt-0.5 text-table text-muted-foreground">
                    Which merchant does this website belong to? The file&apos;s business name, address, phone and hours
                    can start a new merchant Profile.
                  </p>
                  <MerchantPicker value={merchant} onChange={setMerchant} allowNew={canCreateMerchant} disabled={busy} />
                </section>
              )}
              {field("business.email", {}, tried ? emailProblem : undefined)}
              {field("contact.formEmail")}
              {field("business.tagline")}

              {group("Reviews", "The file asks for Google reviews rather than quoted ones.")}
              {field("social.reviewsUrl")}
              {field("social.reviewsWidget")}

              {group("Social links")}
              {field("footer.facebook")}
              {field("footer.instagram")}
              {field("footer.twitter")}
              {field("footer.creditHref")}

              <p className="text-table text-muted-foreground sm:col-span-2">
                Saving creates the website as <strong>In creation</strong> (not public). Everything imported stays editable in the
                normal form — use <em>Review in full form</em> to go through it field by field first.
              </p>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
