"use client";

import { Check } from "lucide-react";
import { Badge, Select } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useTicketPeople } from "@/features/tickets/api";
import { CAME_FROM_HINT, CAME_FROM_LABEL, PARTNER_STAGE_LABEL, PARTNER_STAGE_TONE, formatDay } from "../labels";
import { CAME_FROM, PARTNER_STAGES, type CameFrom, type PartnerStage } from "../types";

/** Roles that sell; they come first in owner pickers. */
const SALES_ROLES = new Set(["SALES_MANAGER", "SALES_EXECUTIVE"]);

export function StageBadge({ stage }: { stage: PartnerStage }) {
  return (
    <Badge tone={PARTNER_STAGE_TONE[stage]} icon={false}>
      {PARTNER_STAGE_LABEL[stage]}
    </Badge>
  );
}

/** "Selling" pill: a deal in the last 30 days. */
export function SellingBadge({ selling, deals }: { selling: boolean; deals?: number }) {
  if (!selling) return null;
  return (
    <Badge tone="success" icon={false} title={deals ? `${deals} deal${deals === 1 ? "" : "s"} in the last 30 days` : undefined}>
      Selling
    </Badge>
  );
}

/**
 * The partner journey as a row of steps. Done steps are filled, the current one
 * is outlined; with `onPick` every step is a button that moves the partner there.
 */
export function StageStepper({
  stage,
  changedAt,
  onPick,
  disabled,
}: {
  stage: PartnerStage;
  changedAt?: string | null;
  onPick?: (s: PartnerStage) => void;
  disabled?: boolean;
}) {
  const current = PARTNER_STAGES.indexOf(stage as (typeof PARTNER_STAGES)[number]);
  return (
    <div className="flex flex-col gap-2" data-testid="stage-stepper">
      <ol className="flex flex-wrap gap-1.5" aria-label="Partner stage">
        {PARTNER_STAGES.map((s, i) => {
          const done = current >= 0 && i < current;
          const here = i === current;
          const label = PARTNER_STAGE_LABEL[s];
          const cls = cn(
            "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors",
            here && "border-primary bg-primary text-primary-foreground",
            done && "border-border bg-muted text-foreground",
            !here && !done && "border-border bg-card text-muted-foreground",
            onPick && !disabled && !here && "hover:border-primary hover:text-foreground",
          );
          return (
            <li key={s}>
              {onPick ? (
                <button
                  type="button"
                  className={cls}
                  disabled={disabled || here}
                  aria-current={here ? "step" : undefined}
                  onClick={() => onPick(s)}
                  title={here ? "Current stage" : `Move to ${label}`}
                >
                  {done ? <Check className="size-3" aria-hidden /> : null}
                  {label}
                </button>
              ) : (
                <span className={cls} aria-current={here ? "step" : undefined}>
                  {done ? <Check className="size-3" aria-hidden /> : null}
                  {label}
                </span>
              )}
            </li>
          );
        })}
        <li>
          {onPick ? (
            <button
              type="button"
              disabled={disabled || stage === "NOT_INTERESTED"}
              onClick={() => onPick("NOT_INTERESTED")}
              className={cn(
                "inline-flex h-7 items-center rounded-full border border-dashed px-2.5 text-xs font-medium",
                stage === "NOT_INTERESTED" ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
              aria-current={stage === "NOT_INTERESTED" ? "step" : undefined}
            >
              Not interested
            </button>
          ) : stage === "NOT_INTERESTED" ? (
            <span className="inline-flex h-7 items-center rounded-full border border-dashed border-foreground px-2.5 text-xs font-medium text-foreground">
              Not interested
            </span>
          ) : null}
        </li>
      </ol>
      {changedAt ? <p className="text-xs text-muted-foreground">Stage since {formatDay(changedAt)}</p> : null}
    </div>
  );
}

export function CameFromSelect({
  value,
  onChange,
  disabled,
  id,
  allowNone = true,
}: {
  value: CameFrom | "";
  onChange: (v: CameFrom | "") => void;
  disabled?: boolean;
  id?: string;
  allowNone?: boolean;
}) {
  return (
    <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as CameFrom | "")} aria-label="Came from">
      {allowNone ? <option value="">Not set</option> : null}
      {CAME_FROM.map((c) => (
        <option key={c} value={c} title={CAME_FROM_HINT[c]}>
          {CAME_FROM_LABEL[c]}
        </option>
      ))}
    </Select>
  );
}

/** Active users, salespeople first. */
export function useSalesPeople() {
  const q = useTicketPeople();
  const all = q.data ?? [];
  const sales = all.filter((p) => SALES_ROLES.has(p.role));
  const others = all.filter((p) => !SALES_ROLES.has(p.role));
  return { ...q, all, sales, others };
}

export function OwnerSelect({
  value,
  onChange,
  disabled,
  id,
  noneLabel = "Unassigned",
  label = "Owner",
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  id?: string;
  noneLabel?: string;
  label?: string;
}) {
  const { sales, others } = useSalesPeople();
  return (
    <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{noneLabel}</option>
      {sales.length ? (
        <optgroup label="Sales team">
          {sales.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {others.length ? (
        <optgroup label="Everyone else">
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  );
}
