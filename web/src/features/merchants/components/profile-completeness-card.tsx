"use client";

import { useState } from "react";
import { ChevronDown, Info, TriangleAlert } from "lucide-react";
import { Card, SectionHead, Skeleton } from "@/components/ui";
import { useProfileAlerts, useProfileCompleteness } from "@/features/merchants/api";
import { cn } from "@/lib/utils/cn";
import type { CompletenessSection, ProfileCompleteness } from "@/features/merchants/types";
import { ProfileAlertsPanel } from "./profile/profile-alerts-panel";

/**
 * Profile completeness — PROF-02, shown on every workspace tab.
 *
 * This is the merchant's headline score: one number, the confidence spread
 * behind it, the section breakdown, and the §6.4 alerts it raises. The Profile
 * tab's own card deliberately does NOT repeat the percent — it lists what is
 * actually missing (PROF-03). One number, one place.
 *
 * The two surfaces read the same server-computed object — this card from
 * `GET /completeness`, the Profile tab from the copy embedded in `GET /fields` —
 * and every mutation invalidates both together (`invalidateProfileDerived`), so
 * they cannot drift. That is the point of the rewrite: this card used to render
 * a hardcoded 72% next to a separately computed percent one screenful below.
 */
export function ProfileCompletenessCard({ merchantId }: { merchantId: string }) {
  const { data, isPending, isError } = useProfileCompleteness(merchantId);
  const { data: alerts } = useProfileAlerts(merchantId);
  const [showSections, setShowSections] = useState(false);

  if (isPending) return <CardSkeleton />;

  // A failed derived view must not break the workspace — the merchant record
  // itself loaded fine. Say so plainly rather than showing a misleading 0%
  // (GLB-01: never present an unavailable value as data).
  if (isError || !data) {
    return (
      <Card className="mt-6">
        <div className="flex items-center gap-2 px-4 py-3.5 text-xs leading-4 text-muted-foreground">
          <Info className="size-4 shrink-0" aria-hidden />
          <span>Profile completeness is unavailable right now.</span>
        </div>
      </Card>
    );
  }

  const openAlerts = alerts ?? [];

  return (
    <section className="mt-6 flex flex-col gap-3" aria-label="Profile completeness">
      <SectionHead title="Profile completeness" link="Open profile" href={`/merchants/${merchantId}/profile`} scroll={false} />
      <Card>
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-6">
        <ScoreDial completeness={data} />

        <div className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-1.5 text-table">
          <Stat dotClassName="bg-success" label="Confirmed" value={data.confidence.confirmed} />
          <Stat dotClassName="bg-primary" label="Inferred" value={data.confidence.needsReview} />
          <Stat dotClassName="bg-muted-foreground" label="Unverified" value={data.confidence.unverified} />
          {data.confidence.outdated > 0 && (
            <Stat dotClassName="bg-warning" label="Outdated" value={data.confidence.outdated} />
          )}
          {data.confidence.placeholder > 0 && (
            <Stat dotClassName="bg-destructive" label="Placeholder" value={data.confidence.placeholder} />
          )}
          <Stat dotClassName="bg-destructive" label="Missing" value={data.confidence.missing} />
        </div>

        <button
          type="button"
          onClick={() => setShowSections((v) => !v)}
          aria-expanded={showSections}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Breakdown
          <ChevronDown className={cn("size-4 transition-transform", showSections && "rotate-180")} aria-hidden />
        </button>
      </div>

      {showSections && (
        <div className="border-t border-border px-4 py-3.5">
          <SectionBreakdown sections={data.sections} />
        </div>
      )}

      {openAlerts.length > 0 && (
        <div className="border-t border-border px-4 py-3.5">
          <div className="mb-2.5 flex items-center gap-2">
            <TriangleAlert className="size-4 text-warning-text" aria-hidden />
            <h3 className="text-table font-semibold text-foreground">
              Needs attention
              <span className="ml-1.5 font-normal text-muted-foreground">
                ({openAlerts.length} {openAlerts.length === 1 ? "alert" : "alerts"})
              </span>
            </h3>
          </div>
          <ProfileAlertsPanel merchantId={merchantId} alerts={openAlerts} />
        </div>
      )}
      </Card>
    </section>
  );
}

/* ---- Score --------------------------------------------------------------- */

function ScoreDial({ completeness }: { completeness: ProfileCompleteness }) {
  const { percent, isComplete, completeAtPct, requiredMissingCount } = completeness;

  return (
    <div className="flex items-center gap-4 sm:w-72 sm:shrink-0">
      <div
        className={cn(
          "text-3xl font-semibold tabular-nums leading-none",
          isComplete ? "text-success-subtle-foreground" : requiredMissingCount > 0 ? "text-warning-text" : "text-foreground",
        )}
      >
        {percent}%
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-table font-semibold text-foreground">Profile completeness</div>
        <div
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Profile ${percent} percent complete`}
        >
          <div
            className={cn("h-full rounded-full transition-[width]", isComplete ? "bg-success" : "bg-primary")}
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {isComplete ? "Complete" : `Target ${completeAtPct}%`}
        </p>
      </div>
    </div>
  );
}

function Stat({ dotClassName, label, value }: { dotClassName: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-foreground">
      <span className={`size-2 rounded-full ${dotClassName}`} aria-hidden />
      <span className="tabular-nums font-medium">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/* ---- Section breakdown ----------------------------------------------------- */

function SectionBreakdown({ sections }: { sections: CompletenessSection[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {sections.map((s) => (
        <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-40 shrink-0 text-table font-medium text-foreground">{s.label}</span>

          {s.applicable ? (
            <>
              <span className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    "block h-full rounded-full",
                    s.percent === 100 ? "bg-success" : "bg-primary",
                  )}
                  style={{ width: `${s.percent}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-foreground">
                {s.percent}%
              </span>
            </>
          ) : (
            /* Not applicable is not zero. A merchant with no access checklist
               seeded has nothing to score here, so its weight is redistributed
               rather than dragging the total down (API §4a.1). */
            <span className="flex-1 text-xs text-muted-foreground">
              Not applicable — nothing recorded yet
            </span>
          )}

          <span className="w-24 shrink-0 text-right text-xs text-muted-foreground" title={`Weight ${s.weight}`}>
            {s.requirement}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---- Skeleton --------------------------------------------------------------- */

function CardSkeleton() {
  return (
    <Card className="mt-6">
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex items-center gap-4 sm:w-72 sm:shrink-0">
          <Skeleton className="h-7 w-14" />
          <div className="flex-1">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
          </div>
        </div>
        <div className="flex flex-1 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-20" />
          ))}
        </div>
      </div>
    </Card>
  );
}
