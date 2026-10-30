"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** − qty + control. `max` caps it; for items you can only have one of, renders an Add / Added toggle. */
export function QtyStepper({
  value,
  max,
  onChange,
  label,
  disabled,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
  label: string;
  disabled?: boolean;
}) {
  if (max <= 1) {
    const on = value > 0;
    return (
      <button
        type="button"
        disabled={disabled}
        aria-pressed={on}
        aria-label={`${on ? "Remove" : "Add"} ${label}`}
        onClick={() => onChange(on ? 0 : 1)}
        className={cn(
          "h-9 min-w-[92px] rounded-lg border px-3 text-sm font-medium transition-colors",
          on
            ? "border-primary bg-primary text-primary-foreground hover:bg-primary-hover"
            : "border-border bg-background text-foreground hover:bg-secondary",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent disabled:opacity-50",
        )}
      >
        {on ? "Added ✓" : "Add"}
      </button>
    );
  }
  const btn =
    "grid size-9 place-items-center rounded-lg border border-border bg-background text-foreground hover:bg-secondary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent";
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={`${label} quantity`}>
      <button type="button" className={btn} disabled={disabled || value <= 0} onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Fewer ${label}`}>
        <Minus className="size-4" />
      </button>
      <input
        inputMode="numeric"
        aria-label={`${label} quantity`}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, "") || "0");
          onChange(Math.min(max, Math.max(0, n)));
        }}
        className={cn(
          "h-9 w-12 rounded-lg border border-border bg-background text-center text-sm font-semibold tabular-nums text-foreground",
          "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent",
          value > 0 && "border-primary",
        )}
      />
      <button type="button" className={btn} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label={`More ${label}`}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}
