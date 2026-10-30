import { cn } from "@/lib/utils/cn";
import { usd } from "../format";
import type { HardwarePlan, Totals } from "../types";

/** The two numbers a restaurant cares about: due at start and per month. */
export function TotalsPanel({
  totals,
  plan,
  leaseMonths = 36,
  busy,
  className,
  audience = "client",
}: {
  totals: Totals;
  plan: HardwarePlan;
  leaseMonths?: number;
  busy?: boolean;
  className?: string;
  /** "staff" words the savings line for the team instead of the restaurant. */
  audience?: "client" | "staff";
}) {
  const savingsOneTime = Number(totals.savingsOneTime);
  const savingsMonthly = Number(totals.savingsMonthly);
  return (
    <div className={cn("rounded-xl border border-border bg-muted/60 p-4 transition-opacity", busy && "opacity-60", className)} aria-live="polite">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Due at start</div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground" data-testid="total-one-time">
            {usd(totals.oneTime)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Monthly</div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground" data-testid="total-monthly">
            {usd(totals.monthly)}
            <span className="text-sm font-normal text-muted-foreground">/mo</span>
          </div>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Software {usd(totals.monthlySoftware)}/mo
        {Number(totals.monthlyLease) > 0 && <> + hardware lease {usd(totals.monthlyLease)}/mo for {leaseMonths} months</>}
        {plan === "BUY" && " · hardware bought outright"}
      </div>
      {(savingsOneTime > 0 || savingsMonthly > 0) && (
        <div className="mt-2 rounded-lg bg-success-subtle px-2.5 py-1.5 text-xs font-medium text-success-subtle-foreground">
          {audience === "staff" ? "Special pricing: below list by " : "Your special pricing saves "}
          {savingsOneTime > 0 && <>{usd(savingsOneTime)} up front</>}
          {savingsOneTime > 0 && savingsMonthly > 0 && " and "}
          {savingsMonthly > 0 && <>{usd(savingsMonthly)}/mo</>}.
        </div>
      )}
    </div>
  );
}
