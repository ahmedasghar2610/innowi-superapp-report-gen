"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Check, Clock, Info, Loader2, Pencil, ShieldCheck, ShieldQuestion, X } from "lucide-react";
import { Button, Input, Select, useToast, BadgeLink } from "@/components/ui";
import { useAttestField, useUpdateProfileField } from "@/features/merchants/api";
import { VERIFICATION_CONFIDENCE } from "@/features/merchants/types/enums";
import { verificationConfidence as confidenceLabels } from "@/lib/enums";
import { isApiError } from "@/lib/api/client";
import { formatDate, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import type { ProfileField, UpdateProfileFieldInput, VerificationConfidence } from "@/features/merchants/types";
import { ConfidenceChip } from "./confidence-chip";

/**
 * One server-driven profile field: label, its value rendered for the field's
 * declared `type`, a confidence chip, and inline edit. The editor is chosen from
 * `field.type` (string/url → text, boolean/enum → select, date → date picker),
 * so a new field added on the backend renders and edits here with no code change.
 * Saving PATCHes just this field via `useUpdateProfileField`.
 */
export function SchemaField({ merchantId, field }: { merchantId: string; field: ProfileField }) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex items-center gap-1 pt-0.5 sm:w-52 sm:shrink-0">
        <span className="text-xs font-medium leading-4 text-muted-foreground">{field.label}</span>
        {field.required && (
          <span className="text-xs leading-4 text-text-destructive" title="Required" aria-label="required">
            *
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {editing ? (
          <FieldEditor
            merchantId={merchantId}
            field={field}
            onDone={() => setEditing(false)}
          />
        ) : (
          <FieldDisplay merchantId={merchantId} field={field} onEdit={() => setEditing(true)} />
        )}
      </div>
    </div>
  );
}

/* ---- Display ---------------------------------------------------------------- */

function FieldDisplay({ merchantId, field, onEdit }: { merchantId: string; field: ProfileField; onEdit: () => void }) {
  const empty = field.value === null || field.value === "";

  const actionClass = cn(
    "inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-medium leading-4 text-muted-foreground",
    "opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
    "sm:opacity-0",
  );

  return (
    <div className="group flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <FieldValue field={field} />
          <ConfidenceChip confidence={field.confidence} />
        </div>
        <FieldMeta field={field} />
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {!empty && <AttestActions merchantId={merchantId} field={field} className={actionClass} />}
        <button type="button" onClick={onEdit} className={actionClass} aria-label={`Edit ${field.label}`}>
          <Pencil className="size-4" />
          {empty ? "Add" : "Edit"}
        </button>
      </div>
    </div>
  );
}

/**
 * Attestation actions (Super App PRD §22): Verify · Mark outdated · Mark
 * placeholder · back to Unverified. Only rendered for a filled field — an empty
 * value has nothing to attest to (the API returns 400 for it anyway). The
 * primary action is whichever transition is most useful from the current state.
 */
function AttestActions({ merchantId, field, className }: { merchantId: string; field: ProfileField; className: string }) {
  const { toast } = useToast();
  const attest = useAttestField();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function run(confidence: VerificationConfidence) {
    setOpen(false);
    attest.mutate(
      { merchantId, key: field.key, input: { confidence } },
      {
        onSuccess: (f) =>
          toast({
            variant: confidence === "CONFIRMED" ? "success" : "info",
            title: `${f.label} — ${confidenceLabels[confidence]?.label ?? confidence}`,
            description:
              confidence === "PLACEHOLDER"
                ? "Excluded from the completion score until replaced with a real value."
                : confidence === "OUTDATED"
                  ? "Flagged for re-verification; the last confirmation date is kept."
                  : undefined,
          }),
        onError: (err) =>
          toast({
            variant: "error",
            title: "Couldn't update attestation",
            description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
          }),
      },
    );
  }

  const busy = attest.isPending;

  return (
    <div className="relative">
      {field.confidence !== "CONFIRMED" && (
        <button type="button" onClick={() => run("CONFIRMED")} disabled={busy} className={className} aria-label={`Verify ${field.label}`}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          Verify
        </button>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More attestation actions for ${field.label}`}
      >
        <ShieldQuestion className="size-4" />
        Attest
      </button>
      <AttestMenu open={open} onClose={() => setOpen(false)} triggerRef={triggerRef} menuRef={menuRef}>
        {field.confidence !== "OUTDATED" && (
          <MenuItem icon={Clock} label="Mark outdated" hint="Was right; needs re-checking" onClick={() => run("OUTDATED")} />
        )}
        {field.confidence !== "PLACEHOLDER" && (
          <MenuItem icon={Ban} label="Mark placeholder" hint="Not real data — exclude from score" onClick={() => run("PLACEHOLDER")} />
        )}
        {field.confidence !== "INFERRED" && (
          <MenuItem icon={Info} label="Mark inferred" hint="Derived from a source, not confirmed" onClick={() => run("INFERRED")} />
        )}
        {field.confidence !== "UNVERIFIED" && (
          <MenuItem icon={ShieldQuestion} label="Reset to unverified" hint="Clear the attestation" onClick={() => run("UNVERIFIED")} />
        )}
      </AttestMenu>
    </div>
  );
}

/**
 * Portals the Attest dropdown to <body> and positions it against the
 * trigger button's live bounding rect. Fixes the menu rendering clipped
 * behind a profile section — the section `Card` uses `overflow-hidden` for
 * its rounded corners, which silently cut off the old inline
 * `absolute`-positioned menu whenever it opened near the section's edge.
 * Reuses the same "teleport out of the clipping ancestor" approach as
 * `Overlay` (Dialog/Drawer), just without the backdrop/focus-trap weight a
 * modal needs — this is a small anchored menu, not a modal.
 */
function AttestMenu({
  open,
  onClose,
  triggerRef,
  menuRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);

  // Recompute position whenever the menu opens, and keep it pinned to the
  // trigger on scroll/resize while it's open (the page can scroll under a
  // fixed-position menu otherwise).
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }

    const MENU_WIDTH = 208; // w-52
    const GUTTER = 8;

    function place() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const left = Math.min(
        Math.max(GUTTER, rect.right - MENU_WIDTH),
        window.innerWidth - MENU_WIDTH - GUTTER,
      );
      setPos({ top: rect.bottom + 4, left });
    }

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, triggerRef]);

  // Close on outside click and Escape.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, menuRef, triggerRef]);

  if (!mounted || !open || !pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", top: pos.top, left: pos.left, width: 208 }}
      className="z-[100] overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
    >
      {children}
    </div>,
    document.body,
  );
}

function MenuItem({ icon: Icon, label, hint, onClick }: { icon: typeof Clock; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-secondary">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block text-table font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

/** Render the value formatted for its type. */
function FieldValue({ field }: { field: ProfileField }) {
  if (field.value === null || field.value === "") {
    return <span className="text-sm leading-5 text-muted-foreground">Not set</span>;
  }

  if (field.type === "boolean") {
    return <span className="text-sm leading-5 text-foreground">{field.value === true ? "Yes" : "No"}</span>;
  }

  if (field.type === "date" && typeof field.value === "string") {
    return <span className="text-sm leading-5 text-foreground">{formatDate(field.value)}</span>;
  }

  if (field.type === "decimal" && typeof field.value === "string") {
    return (
      <span className="text-sm font-medium leading-5 tabular-nums text-foreground">{formatUsd(field.value)}</span>
    );
  }

  if (field.type === "url" && typeof field.value === "string") {
    const shown = field.value.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="text-sm leading-5 text-foreground">{shown}</span>
        <BadgeLink href={field.value} title={shown} aria-label={`Open ${shown}`} />
      </span>
    );
  }

  return <span className="text-sm leading-5 text-foreground">{String(field.value)}</span>;
}

/**
 * Verification provenance line under the value, plus the registry's editorial
 * note when it carries one. The note is server-driven (`ProfileField.note`), so
 * the ownership caveat on the master budget fields lives with the field
 * definition rather than being hardcoded in this component.
 */
function FieldMeta({ field }: { field: ProfileField }) {
  const bits: string[] = [];
  if (field.source) bits.push(`Source: ${field.source}`);
  if (field.confidence === "OUTDATED") {
    bits.push(
      field.verifiedAt
        ? `Last confirmed ${formatDate(field.verifiedAt)}${field.verifiedBy ? ` by ${field.verifiedBy}` : ""} — re-verify`
        : "Marked outdated — re-verify",
    );
  } else if (field.confidence === "PLACEHOLDER") {
    bits.push("Placeholder — excluded from completeness until replaced");
  } else if (field.verified && field.verifiedAt) {
    bits.push(`${field.confidence === "INFERRED" ? "Inferred" : "Verified"} ${formatDate(field.verifiedAt)}${field.verifiedBy ? ` by ${field.verifiedBy}` : ""}`);
  }
  if (bits.length === 0 && !field.note) return null;

  return (
    <>
      {bits.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{bits.join(" · ")}</p>}
      {field.note && (
        <p className="mt-1 flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
          <Info className="mt-[1px] size-4 shrink-0" aria-hidden />
          {field.note}
        </p>
      )}
    </>
  );
}

/* ---- Editor ----------------------------------------------------------------- */

/** Seed the editor's string state from the field value for its type. */
function toEditValue(field: ProfileField): string {
  if (field.value === null) return "";
  if (field.type === "boolean") return field.value === true ? "true" : field.value === false ? "false" : "";
  if (field.type === "date" && typeof field.value === "string") return field.value.slice(0, 10);
  if (field.type === "decimal" && typeof field.value === "string") return field.value;
  return String(field.value);
}

function FieldEditor({
  merchantId,
  field,
  onDone,
}: {
  merchantId: string;
  field: ProfileField;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState(() => toEditValue(field));
  const [confidence, setConfidence] = useState<VerificationConfidence>(field.confidence);
  const [error, setError] = useState<string | null>(null);

  const update = useUpdateProfileField();
  const controlId = `field-${field.key}`;

  function submit() {
    setError(null);

    // Type-aware client validation (the server is authoritative; this just
    // catches obvious mistakes and shapes the payload the DTO expects).
    let payloadValue: string | boolean | number;

    if (field.type === "boolean") {
      if (value !== "true" && value !== "false") return setError("Choose Yes or No.");
      payloadValue = value === "true";
    } else if (field.type === "decimal") {
      const v = value.trim();
      if (!v) return setError("Enter an amount.");
      const n = Number(v);
      if (!Number.isFinite(n)) return setError("Enter a valid number.");
      if (n < 0) return setError("Amount can't be negative.");
      payloadValue = n;
    } else if (field.type === "integer") {
      const v = value.trim();
      if (!v) return setError("Enter a number.");
      const n = Number(v);
      if (!Number.isInteger(n)) return setError("Enter a whole number.");
      if (n < 0) return setError("Can't be negative.");
      payloadValue = n;
    } else if (field.type === "enum") {
      if (!value) return setError("Choose an option.");
      if (field.options && !field.options.includes(value)) return setError("Choose a valid option.");
      payloadValue = value;
    } else if (field.type === "date") {
      if (!value) return setError("Pick a date.");
      payloadValue = new Date(`${value}T00:00:00.000Z`).toISOString();
    } else if (field.type === "url") {
      const v = value.trim();
      if (!v) return setError("Enter a URL.");
      if (!/^https?:\/\/.+/i.test(v)) return setError("Enter a full URL including http:// or https://.");
      payloadValue = v;
    } else {
      const v = value.trim();
      if (!v) return setError("Enter a value.");
      payloadValue = v;
    }

    const input: UpdateProfileFieldInput = { value: payloadValue };
    // Only send confidence when the reviewer actually changed it.
    if (confidence !== field.confidence) input.confidence = confidence;

    update.mutate(
      { merchantId, key: field.key, input },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Field updated", description: field.label });
          onDone();
        },
        onError: (err) => {
          setError(isApiError(err) ? err.messages[0] : "Couldn't save. Please try again.");
        },
      },
    );
  }

  const busy = update.isPending;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex-1">
          <ValueControl
            id={controlId}
            field={field}
            value={value}
            invalid={!!error}
            disabled={busy}
            onChange={setValue}
            onEnter={submit}
          />
        </div>

        <div className="sm:w-40">
          <Select
            aria-label="Confidence"
            value={confidence}
            disabled={busy}
            onChange={(e) => setConfidence(e.target.value as VerificationConfidence)}
          >
            {VERIFICATION_CONFIDENCE.map((c) => (
              <option key={c} value={c}>
                {confidenceLabels[c]?.label ?? c}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="default" onClick={submit} loading={busy} aria-label="Save">
            <Check className="size-4" />
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone} disabled={busy} aria-label="Cancel" type="button">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-xs text-text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {busy ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-4 animate-spin" /> Saving…
            </span>
          ) : (
            "Press Enter or Save to apply."
          )}
        </p>
      )}
    </div>
  );
}

/** The type-appropriate input for the editor. */
function ValueControl({
  id,
  field,
  value,
  invalid,
  disabled,
  onChange,
  onEnter,
}: {
  id: string;
  field: ProfileField;
  value: string;
  invalid: boolean;
  disabled: boolean;
  onChange: (v: string) => void;
  onEnter: () => void;
}) {
  const common = {
    id,
    value,
    disabled,
    "aria-invalid": invalid || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange(e.target.value),
  };

  if (field.type === "boolean") {
    return (
      <Select {...common}>
        <option value="">Select…</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    );
  }

  if (field.type === "enum") {
    return (
      <Select {...common}>
        <option value="">Select…</option>
        {(field.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </Select>
    );
  }

  const numeric = field.type === "decimal" || field.type === "integer";
  const inputType = field.type === "date" ? "date" : field.type === "url" ? "url" : numeric ? "number" : "text";
  return (
    <Input
      {...common}
      type={inputType}
      inputMode={field.type === "url" ? "url" : field.type === "decimal" ? "decimal" : field.type === "integer" ? "numeric" : undefined}
      min={numeric ? 0 : undefined}
      step={field.type === "decimal" ? "0.01" : field.type === "integer" ? "1" : undefined}
      placeholder={field.type === "url" ? "https://example.com" : field.type === "decimal" ? "0.00" : field.type === "integer" ? "0" : field.label}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

