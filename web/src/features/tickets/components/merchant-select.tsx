"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Search, X } from "lucide-react";
import { Spinner } from "@/components/ui";
import { useMerchants } from "@/features/merchants/api/merchants.queries";
import { cn } from "@/lib/utils/cn";

export interface MerchantValue {
  id: string;
  name: string;
}

/**
 * Optional merchant for a ticket: search the directory, or leave empty for
 * internal work. Lighter than the website module's MerchantPicker, whose
 * wording ("leave unassigned", "create from these details") is about sites.
 */
export function MerchantSelect({
  value,
  onChange,
  disabled,
  id,
  placeholder = "Internal — or search a merchant…",
}: {
  value: MerchantValue | null;
  onChange: (value: MerchantValue | null) => void;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
}) {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onTerm = (v: string) => {
    setTerm(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSearch(v.trim()), 250);
  };

  const { data, isFetching } = useMerchants({ search, limit: 8 }, { enabled: search.length >= 2 });
  const results = search.length >= 2 ? (data?.data ?? []) : [];

  if (value) {
    return (
      <div className="flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm">
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-foreground">{value.name}</span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Remove merchant"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        id={id}
        type="search"
        value={term}
        disabled={disabled}
        onChange={(e) => onTerm(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
      />
      {isFetching && <Spinner className="absolute right-2.5 top-1/2 -translate-y-1/2" />}
      {search.length >= 2 && !isFetching && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {results.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No merchant matches “{search}”.</p>
          ) : (
            results.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange({ id: m.id, name: m.restaurantName });
                  setTerm("");
                  setSearch("");
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent",
                )}
              >
                <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{m.restaurantName}</span>
                {m.cuisineCategory ? (
                  <span className="ml-auto truncate text-xs text-muted-foreground">{m.cuisineCategory}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
