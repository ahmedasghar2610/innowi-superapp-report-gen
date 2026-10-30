"use client";

import { cn } from "@/lib/utils/cn";

/** Segmented filter (28px pills) used on the Issues and Changes lists. */
export function FilterPills<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium leading-4 transition-colors",
              on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="tabular-nums text-muted-foreground">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">{title}</h1>
        <p className="mt-1 text-table text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
