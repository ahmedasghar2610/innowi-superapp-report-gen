"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, Search, Sparkles, UserPlus, X } from "lucide-react";
import { Badge, Spinner } from "@/components/ui";
import { useMerchants } from "@/features/merchants/api/merchants.queries";
import { cn } from "@/lib/utils/cn";
import type { MerchantChoice, MerchantSuggestion } from "../types";

interface MerchantPickerProps {
  value: MerchantChoice;
  onChange: (choice: MerchantChoice) => void;
  /** Likely owners, when the site already exists (GET /merchant-suggestions). */
  suggestions?: MerchantSuggestion[];
  /** Offer "create a new merchant from these answers". Needs `merchant.create`. */
  allowNew?: boolean;
  /** Offer "leave unassigned" (default true). */
  allowNone?: boolean;
  disabled?: boolean;
}

/**
 * Choose the merchant a website belongs to: pick from suggestions, search the
 * directory, create one from the site's answers, or leave it unassigned.
 * Shared by the intake form, the .docx import and the "Link to merchant"
 * dialog so every path asks the same question the same way.
 */
export function MerchantPicker({
  value,
  onChange,
  suggestions = [],
  allowNew = true,
  allowNone = true,
  disabled,
}: MerchantPickerProps) {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const handleTerm = (v: string) => {
    setTerm(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSearch(v.trim()), 250);
  };

  const { data, isFetching } = useMerchants({ search, limit: 8 }, { enabled: search.length >= 2 });
  const results = search.length >= 2 ? (data?.data ?? []) : [];

  const pick = (merchantId: string, merchantName: string) => {
    onChange({ mode: "existing", merchantId, merchantName });
    setTerm("");
    setSearch("");
  };

  /** One selectable row. `key` is required: rows are rendered from lists. */
  const option = (
    key: string,
    active: boolean,
    onClick: () => void,
    icon: React.ReactNode,
    title: string,
    hint?: string,
  ) => (
    <button
      key={key}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
        disabled && "opacity-60",
      )}
    >
      <span className={cn("mt-0.5 shrink-0 [&_svg]:size-4", active ? "text-primary" : "text-muted-foreground")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      {active && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      {value.mode === "existing" ? (
        option(
          `selected-${value.merchantId}`,
          true,
          () => {},
          <Building2 />,
          value.merchantName,
          "This website will belong to this merchant. Its Profile supplies the business details.",
        )
      ) : null}
      {value.mode === "existing" && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ mode: allowNone ? "none" : "new" })}
          className="self-start text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <X className="mr-1 inline size-3" aria-hidden />
          Choose a different merchant
        </button>
      )}

      {value.mode !== "existing" && (
        <>
          {suggestions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="size-3.5" aria-hidden /> Looks like
              </p>
              {suggestions.map((s) =>
                option(
                  `suggestion-${s.merchantId}`,
                  false,
                  () => pick(s.merchantId, s.restaurantName),
                  <Building2 />,
                  s.restaurantName,
                  [s.city, ...s.reasons].filter(Boolean).join(" · "),
                ),
              )}
            </div>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={term}
              disabled={disabled}
              onChange={(e) => handleTerm(e.target.value)}
              placeholder="Search merchants by name…"
              aria-label="Search merchants"
              className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
            />
            {isFetching && <Spinner className="absolute right-2.5 top-1/2 -translate-y-1/2" />}
          </div>
          {search.length >= 2 && !isFetching && results.length === 0 && (
            <p className="px-1 text-xs text-muted-foreground">No merchant matches “{search}”.</p>
          )}
          {results.length > 0 && (
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {results.map((m) =>
                option(
                  `result-${m.id}`,
                  false,
                  () => pick(m.id, m.restaurantName),
                  <Building2 />,
                  m.restaurantName,
                  [m.cuisineCategory, m.websiteUrl ? "has a website URL" : ""].filter(Boolean).join(" · "),
                ),
              )}
            </div>
          )}

          <div className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2">
            {allowNew &&
              option(
                "new",
                value.mode === "new",
                () => onChange({ mode: "new" }),
                <UserPlus />,
                "Create a new merchant from these details",
                "Name, address, phone, hours and email become the merchant's Profile. Package and account manager are set afterwards.",
              )}
            {allowNone &&
              option(
                "none",
                value.mode === "none",
                () => onChange({ mode: "none" }),
                <Badge tone="neutral">—</Badge>,
                "Leave unassigned for now",
                "You can link it to a merchant later from the websites list.",
              )}
          </div>
        </>
      )}
    </div>
  );
}
