"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import {
  EMOJI_GROUPS,
  FONT_CATEGORIES,
  FONT_OPTIONS,
  LIST_SEPARATOR,
  googleFontsHref,
  splitFieldList,
} from "../data/pickers";

/* ------------------------------------------------------------------ shared */

/**
 * Open/close for an inline panel: Escape and a click outside close it. The
 * panel expands in the page flow (not a floating popover) so the form dialog's
 * scroll area can never clip it.
 */
function useDisclosure() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const triggerClass =
  "flex h-8 w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted/50 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent data-[invalid=true]:border-destructive";

/** Loads a Google Fonts stylesheet once per href, for previews. */
function useStylesheet(href: string | null) {
  useEffect(() => {
    if (!href) return;
    if (document.querySelector(`link[data-font-preview="${CSS.escape(href)}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.fontPreview = href;
    document.head.appendChild(link);
  }, [href]);
}

const ALL_FONTS_HREF = googleFontsHref(FONT_OPTIONS.map((f) => f.family));
const KNOWN = new Set(FONT_OPTIONS.map((f) => f.family.toLowerCase()));

/* -------------------------------------------------------------------- font */

/**
 * Pick a Google Font from a curated list — each option shown in its own
 * typeface — or type any other Google Fonts family. Stores the family name
 * ("Playfair Display"), which is what the site template expects.
 */
export function FontControl({
  id,
  value,
  invalid,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  invalid: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const { open, setOpen, ref } = useDisclosure();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // The whole list's stylesheet only once someone opens a picker; a custom
  // family gets its own so the trigger can show it.
  useStylesheet(open || (value && KNOWN.has(value.toLowerCase())) ? ALL_FONTS_HREF : null);
  useStylesheet(value && !KNOWN.has(value.toLowerCase()) ? googleFontsHref([value]) : null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => FONT_OPTIONS.filter((f) => !q || f.family.toLowerCase().includes(q)), [q]);
  const custom = query.trim();
  const offerCustom = custom.length > 1 && !KNOWN.has(custom.toLowerCase());

  const pick = (family: string) => {
    onChange(family);
    setOpen(false);
  };

  return (
    <div ref={ref} className="flex flex-col gap-1.5">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-invalid={invalid || undefined}
        onClick={() => setOpen(!open)}
        className={triggerClass}
      >
        <span
          className={cn("min-w-0 flex-1 truncate", !value && "text-muted-foreground")}
          style={value ? { fontFamily: `"${value}", sans-serif` } : undefined}
        >
          {value || placeholder || "Template default"}
        </span>
        {value && !KNOWN.has(value.toLowerCase()) && (
          <span className="shrink-0 rounded-sm bg-muted px-1.5 text-[11px] text-muted-foreground">custom</span>
        )}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="rounded-md border border-border bg-card shadow-sm">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (matches[0]) pick(matches[0].family);
                  else if (offerCustom) pick(custom);
                }
              }}
              placeholder="Search fonts, or type any Google Font name"
              aria-label="Search fonts"
              className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm focus-visible:border-primary focus-visible:outline-none"
            />
          </div>

          <div role="listbox" aria-label="Fonts" className="max-h-64 overflow-y-auto p-1">
            <FontRow label="Template default" active={!value} onClick={() => pick("")} muted />
            {FONT_CATEGORIES.map((cat) => {
              const rows = matches.filter((f) => f.category === cat);
              if (!rows.length) return null;
              return (
                <div key={cat}>
                  <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {cat}
                  </p>
                  {rows.map((f) => (
                    <FontRow
                      key={f.family}
                      label={f.family}
                      family={f.family}
                      active={value.toLowerCase() === f.family.toLowerCase()}
                      onClick={() => pick(f.family)}
                    />
                  ))}
                </div>
              );
            })}
            {offerCustom && (
              <button
                type="button"
                onClick={() => pick(custom)}
                className="mt-1 flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
              >
                <Plus className="size-4 text-muted-foreground" />
                Use “{custom}” (any Google Fonts family)
              </button>
            )}
            {!matches.length && !offerCustom && (
              <p className="px-2 py-3 text-sm text-muted-foreground">No font matches.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FontRow({
  label,
  family,
  active,
  muted,
  onClick,
}: {
  label: string;
  family?: string;
  active: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted",
        active && "bg-primary/5",
        muted && "text-muted-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-[15px]" style={family ? { fontFamily: `"${family}", sans-serif` } : undefined}>
        {label}
      </span>
      {active && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

/* ------------------------------------------------------------------- emoji */

/** Pick an icon from a food / service set, or paste any emoji. */
export function EmojiControl({
  id,
  value,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const { open, setOpen, ref } = useDisclosure();

  return (
    <div ref={ref} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          id={id}
          type="button"
          aria-expanded={open}
          data-invalid={invalid || undefined}
          aria-label={value ? `Icon ${value}, change` : "Choose an icon"}
          onClick={() => setOpen(!open)}
          className={cn(triggerClass, "w-auto shrink-0 justify-center px-2")}
        >
          <span className="text-lg leading-none">{value || "☆"}</span>
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="or paste any emoji"
          aria-label="Icon (emoji)"
          className="min-w-0"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear icon"
            className="grid size-7 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {open && (
        <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-card p-2 shadow-sm">
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label} className="mb-1.5">
              <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-0.5">
                {group.emoji.map((e) => (
                  <button
                    key={e}
                    type="button"
                    aria-label={`Use ${e}`}
                    aria-pressed={value === e}
                    onClick={() => {
                      onChange(e);
                      setOpen(false);
                    }}
                    className={cn(
                      "grid size-9 place-items-center rounded-md text-xl hover:bg-muted",
                      value === e && "bg-primary/10 ring-1 ring-primary",
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- chips */

/**
 * A "·"-separated list (form fields) as toggle chips. Presets toggle on/off;
 * labels typed earlier that aren't presets stay as removable chips; anything
 * else can be added. Order is kept, and the stored value is the same
 * "Name · Email · Phone" text the template reads.
 */
export function ChipsControl({
  id,
  value,
  presets,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  presets: string[];
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const items = splitFieldList(value);
  const lower = items.map((i) => i.toLowerCase());
  const [draft, setDraft] = useState("");
  const customs = items.filter((i) => !presets.some((p) => p.toLowerCase() === i.toLowerCase()));

  const write = (next: string[]) => onChange(next.join(LIST_SEPARATOR));
  const toggle = (label: string) => {
    const at = lower.indexOf(label.toLowerCase());
    if (at >= 0) write(items.filter((_, i) => i !== at));
    else write([...items, label]);
  };
  const add = () => {
    const label = draft.trim().replace(/[·•|]/g, "");
    if (label && !lower.includes(label.toLowerCase())) write([...items, label]);
    setDraft("");
  };

  return (
    <div id={id} aria-invalid={invalid || undefined} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Fields">
        {presets.map((p) => {
          const on = lower.includes(p.toLowerCase());
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(p)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors",
                on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {on ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
              {p}
            </button>
          );
        })}
        {customs.map((c) => (
          <span
            key={c}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-primary bg-primary/10 pl-2.5 pr-1 text-xs font-medium text-foreground"
          >
            {c}
            <button
              type="button"
              aria-label={`Remove ${c}`}
              onClick={() => toggle(c)}
              className="grid size-5 place-items-center rounded-full hover:bg-primary/15"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add another field, e.g. Allergies (optional)"
          aria-label="Add a field"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          <Plus className="size-4" />
          Add
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {items.length ? `Shown in this order: ${items.join(" · ")}` : "None selected — the template's default fields are used."}
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- suggest */

/** A text box with a suggestion list — pick one or type anything. */
export function SuggestControl({
  id,
  value,
  invalid,
  placeholder,
  suggestions,
  onChange,
}: {
  id: string;
  value: string;
  invalid: boolean;
  placeholder?: string;
  suggestions: string[];
  onChange: (value: string) => void;
}) {
  const listId = `${id}-list`;
  return (
    <>
      <Input
        id={id}
        list={listId}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}
