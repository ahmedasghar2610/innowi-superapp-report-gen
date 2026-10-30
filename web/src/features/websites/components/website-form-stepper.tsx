"use client";

import { Check, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { WebsiteFormStep } from "../types";

export type StepState = "current" | "done" | "error" | "todo";

interface WebsiteFormStepperProps {
  steps: WebsiteFormStep[];
  current: number;
  /** State per step id, resolved by the drawer. */
  states: Record<string, StepState>;
  onSelect: (index: number) => void;
}

/**
 * Progress rail across the top of the form drawer. Nodes are clickable so you
 * can jump back to a step you've already seen; the connecting track fills in up
 * to the furthest step reached.
 *
 * Colours come straight from the design-system tokens — `primary` for reached
 * and current, `destructive` for a step with outstanding required fields,
 * `muted`/`border` for everything still ahead.
 */
export function WebsiteFormStepper({ steps, current, states, onSelect }: WebsiteFormStepperProps) {
  return (
    <ol className="flex min-w-max items-start gap-0">
      {steps.map((step, i) => {
        const state = states[step.id] ?? "todo";
        const reached = i <= current;

        return (
          <li key={step.id} className="relative flex min-w-[76px] flex-1 flex-col items-center">
            {/* Track back to the previous node. */}
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1/2 top-[13px] z-0 h-0.5 w-full transition-colors",
                  reached ? "bg-primary" : "bg-border",
                )}
              />
            )}

            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={state === "current" ? "step" : undefined}
              className="relative z-[1] flex flex-col items-center gap-1.5 rounded-md px-1 pb-0.5 outline-none"
            >
              <span
                className={cn(
                  "grid size-7 place-items-center rounded-full border text-xs font-semibold transition-colors [&_svg]:size-4",
                  state === "current" &&
                    "border-primary bg-primary text-primary-foreground ring-4 ring-accent",
                  state === "done" && "border-primary bg-primary text-primary-foreground",
                  state === "error" && "border-destructive bg-card text-text-destructive",
                  state === "todo" && "border-border bg-card text-muted-foreground",
                )}
              >
                {state === "done" ? (
                  <Check aria-hidden />
                ) : state === "error" ? (
                  <TriangleAlert aria-hidden />
                ) : (
                  i + 1
                )}
              </span>

              <span
                className={cn(
                  "whitespace-nowrap text-xs font-medium transition-colors",
                  state === "current" && "text-primary",
                  state === "error" && "text-text-destructive",
                  state === "done" && "text-foreground",
                  state === "todo" && "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
