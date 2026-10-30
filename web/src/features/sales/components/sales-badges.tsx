"use client";

import { ExternalLink } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui";
import { salesforceRecordUrl } from "../format";
import { useSalesContext } from "./sales-shell";
import type { Deal, SupportCase, Visit } from "../types";

/**
 * Touchpoint health → badge tone. Innowi's org uses Green, Yellow, Orange, Red,
 * Newly Deployed, Not Live and N/A. Anything else stays neutral.
 */
export function healthTone(health: string | null | undefined): BadgeTone {
  const h = (health ?? "").trim().toLowerCase();
  if (h === "green") return "success";
  if (h === "yellow" || h === "orange") return "warning";
  if (h === "red") return "danger";
  if (h === "newly deployed") return "accent";
  return "neutral";
}

export function HealthBadge({ health }: { health: string | null | undefined }) {
  if (!health) return <span className="text-muted-foreground">—</span>;
  const tone = healthTone(health);
  return (
    <Badge tone={tone} icon={tone === "accent" || tone === "neutral" ? false : undefined}>
      {health}
    </Badge>
  );
}

/** Stage badge plus a "Stale" / "No change 30+ days" flag for open deals. */
export function DealStageBadge({ deal }: { deal: Deal }) {
  const tone: BadgeTone = deal.isWon ? "success" : deal.isOpen ? "accent" : "neutral";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={tone} icon={false} title={deal.columnLabel !== deal.stageName ? `Shown under "${deal.columnLabel}"` : undefined}>
        {deal.stageName}
      </Badge>
      <DealFlag deal={deal} />
    </span>
  );
}

export function DealFlag({ deal }: { deal: Deal }) {
  if (deal.isStale) {
    return (
      <Badge tone="danger" title={`No change for ${deal.daysSinceChange ?? "180+"} days`}>
        Stale
      </Badge>
    );
  }
  if (deal.isStuck) {
    return (
      <Badge tone="warning" title={`No change for ${deal.daysSinceChange ?? "30+"} days`}>
        {deal.daysSinceChange != null ? `${deal.daysSinceChange}d no change` : "Stuck"}
      </Badge>
    );
  }
  return null;
}

export function VisitStatusBadge({ visit }: { visit: Visit }) {
  if (visit.isOverdue) return <Badge tone="danger">Overdue{visit.status ? ` · ${visit.status}` : ""}</Badge>;
  const s = (visit.status ?? "").toLowerCase();
  if (s === "completed") return <Badge tone="success">{visit.status}</Badge>;
  if (s === "cancelled" || s === "not qualified") return <Badge tone="neutral" icon={false}>{visit.status}</Badge>;
  return (
    <Badge tone="accent" icon={false}>
      {visit.status ?? "Open"}
    </Badge>
  );
}

export function CaseStatusBadge({ c }: { c: SupportCase }) {
  if (c.isClosed) return <Badge tone="neutral" icon={false}>{c.status ?? "Closed"}</Badge>;
  const high = (c.priority ?? "").toLowerCase() === "high";
  return (
    <Badge tone={high ? "warning" : "accent"} icon={high ? undefined : false}>
      {c.status ?? "Open"}
      {high ? " · High" : ""}
    </Badge>
  );
}

/**
 * "Open in Salesforce" link. Only managers/admins get a base URL from the API
 * (reps sign in to the partner portal, where Lightning record links don't open),
 * so for everyone else this renders nothing.
 */
export function SalesforceLink({ sobject, id, label = "Open in Salesforce" }: { sobject: string; id: string; label?: string }) {
  const { me } = useSalesContext();
  const href = salesforceRecordUrl(me.salesforceUrl, sobject, id);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
    >
      {label}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}
