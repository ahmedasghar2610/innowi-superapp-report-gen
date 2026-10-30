import Link from "next/link";
import { CircleAlert, TriangleAlert, Database, Sparkles, DollarSign, ChevronRight, type LucideIcon } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui";
import type { IssueItem, Severity } from "../data/command-center.mock";

/*
 * 4 · Issue card / 6 · Opportunity card (Figma node 20:216): severity badge +
 * module tag + status · title 14/20 semibold · merchant · location 12/16 muted
 * · impact row (dollar icon) · owner row (20px initials avatar) + chevron.
 * Severity badges take their status colour only, always with icon + label.
 */
const SEVERITY: Record<Severity, { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  critical: { label: "Critical", tone: "danger", icon: CircleAlert },
  high: { label: "High", tone: "danger", icon: TriangleAlert },
  medium: { label: "Medium", tone: "warning", icon: TriangleAlert },
  low: { label: "Low", tone: "neutral", icon: TriangleAlert },
  data: { label: "Data", tone: "dataq", icon: Database },
  opportunity: { label: "Opportunity", tone: "accent", icon: Sparkles },
};

export function IssueCard({ item }: { item: IssueItem }) {
  const sev = SEVERITY[item.severity];
  return (
    <Link
      href={item.href}
      className="flex flex-col gap-[9px] rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary-border focus-visible:outline-none"
    >
      <div className="flex items-center gap-[7px]">
        <Badge tone={sev.tone} icon={sev.icon} className="font-semibold">
          {sev.label}
        </Badge>
        <span className="rounded-[4px] bg-muted px-[7px] py-[3px] text-xs font-medium leading-4 text-muted-foreground">{item.module}</span>
        <span className="ml-2.5 text-xs font-medium leading-4 text-muted-foreground">{item.status}</span>
      </div>
      <h3 className="text-sm font-semibold leading-5 text-foreground">{item.title}</h3>
      <p className="whitespace-pre text-xs leading-4 text-muted-foreground">
        {item.location ? `${item.merchant}  ·  ${item.location}` : item.merchant || "\u00a0"}
      </p>
      <div className="flex items-center gap-[5px]">
        <DollarSign className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-xs font-medium leading-4 text-foreground">{item.impact}</span>
      </div>
      <div className="flex items-center gap-[7px]">
        {item.owner ? (
          <>
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold leading-4 text-accent-foreground" aria-hidden>
              {item.owner.initials}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs leading-4 text-muted-foreground">{item.owner.name}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-medium leading-4 text-primary">{item.cta ?? "Open"}</span>
        )}
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </div>
    </Link>
  );
}
