"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { ProfileAlert } from "@/features/merchants/types";
import { ALERT_ICONS, AlertSeverityBadge } from "./alert-badges";

/**
 * The §6.4 profiling alerts — Restaurant Profile Incomplete · Missing
 * Information · Missing Files · Platform Connection Pending.
 *
 * Each alert renders the platform's canonical Issue chain (Super App §19):
 * what happened → evidence → impact → recommendation → action. The evidence and
 * impact are collapsed by default because the summary plus the recommendation is
 * what someone triaging actually needs; the rest is there when they want to
 * justify the call. "Same thing, same shape" (§7 principle 17) — this is the
 * shape an Issue card will have when the Issues platform lands.
 */
export function ProfileAlertsPanel({
  merchantId,
  alerts,
}: {
  merchantId: string;
  alerts: ProfileAlert[];
}) {
  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-card)] bg-success-subtle px-3 py-2.5 text-table text-success-subtle-foreground">
        <CircleCheck className="size-4 shrink-0" aria-hidden />
        <span>Nothing needs attention on this profile.</span>
      </div>
    );
  }

  return <PagedAlerts merchantId={merchantId} alerts={alerts} />;
}

/** Alerts shown per page. Two keeps the card compact; the pager reveals the rest. */
const PAGE_SIZE = 2;

/**
 * The alert list is sorted by severity server-side, so page 1 is always the
 * two most urgent. Paged rather than truncated-with-"show more" so the card's
 * height is stable — with eight alert types now possible, an expanded list
 * pushed every section of the workspace below the fold.
 */
function PagedAlerts({ merchantId, alerts }: { merchantId: string; alerts: ProfileAlert[] }) {
  const pageCount = Math.max(1, Math.ceil(alerts.length / PAGE_SIZE));
  const [page, setPage] = useState(0);

  // Alerts resolve as the user fixes things; never leave the pager on an empty page.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const start = page * PAGE_SIZE;
  const visible = alerts.slice(start, start + PAGE_SIZE);

  return (
    <div>
      <ul className="flex flex-col gap-2" aria-label="Profile alerts">
        {visible.map((alert) => (
          <li key={alert.id}>
            <AlertCard merchantId={merchantId} alert={alert} />
          </li>
        ))}
      </ul>
      {alerts.length > PAGE_SIZE && (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Showing <span className="font-medium text-foreground tabular-nums">{start + 1}–{Math.min(start + PAGE_SIZE, alerts.length)}</span> of{" "}
            <span className="font-medium text-foreground tabular-nums">{alerts.length}</span>
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous alerts">
              <ChevronLeft className="size-4" />
              Prev
            </Button>
            <span className="tabular-nums">{page + 1} / {pageCount}</span>
            <Button variant="ghost" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next alerts">
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AlertCard({ merchantId, alert }: { merchantId: string; alert: ProfileAlert }) {
  const [open, setOpen] = useState(false);
  const Icon = ALERT_ICONS[alert.type];
  const detailsId = `alert-details-${alert.type.replace(/\./g, "-")}`;

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-card">
      <div className="flex flex-wrap items-start gap-2.5 px-3.5 py-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-table font-semibold text-foreground">{alert.title}</h4>
            <AlertSeverityBadge severity={alert.severity} />
          </div>

          <p className="mt-1 text-table leading-snug text-foreground">{alert.summary}</p>

          <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">Recommended: </span>
            {alert.recommendation}
          </p>

          {open && (
            <div id={detailsId} className="mt-3 flex flex-col gap-2.5 border-t border-border pt-2.5">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Evidence
                </p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {alert.evidence.map((e, i) => (
                    <li
                      key={`${e.label}-${i}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-foreground"
                      title={`Source: ${e.source}`}
                    >
                      {e.label}
                      <span className="text-muted-foreground">· {e.source}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Impact
                </p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{alert.impact}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Link
            href={`/merchants/${merchantId}/${alert.targetTab}`}
            scroll={false}
            className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-secondary hover:underline"
          >
            Resolve
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={detailsId}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <span className="sr-only">
              {open ? "Hide" : "Show"} evidence and impact for {alert.title}
            </span>
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
