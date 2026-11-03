"use client";

import { Card } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { STATUS_META, type RowStatus } from "./report-status";

/** The four headline stats plus the monthly pipeline bar. */
export function QueueSummary({
  counts,
  total,
  monthLabel,
  approvedName,
  onNeedsAction,
}: {
  counts: Record<RowStatus, number>;
  total: number;
  monthLabel: string;
  /** The single approved merchant's name, when there is exactly one. */
  approvedName: string | null;
  onNeedsAction: () => void;
}) {
  const attention = (["due", "draft", "edited", "failed"] as RowStatus[]).reduce((a, k) => a + (counts[k] ?? 0), 0);
  const drafts = (counts.draft ?? 0) + (counts.edited ?? 0);
  const toGenerate = counts.due ?? 0;
  const approved = counts.approved ?? 0;
  const sent = counts.sent ?? 0;

  // Only non-zero statuses get a bar segment; the zero ones are summarised in
  // one muted line instead of five empty legend entries.
  const present = (Object.keys(STATUS_META) as RowStatus[]).filter((k) => (counts[k] ?? 0) > 0);
  const legend = present.includes("sent") ? present : [...present, "sent" as RowStatus];
  const zero = (["generating", "edited", "failed"] as RowStatus[]).filter((k) => !(counts[k] ?? 0));

  const linkBits = [drafts > 0 ? `Review ${drafts} draft${drafts === 1 ? "" : "s"}` : null, toGenerate > 0 ? `generate ${toGenerate}` : null].filter(Boolean);

  return (
    <Card className="rounded-xl p-0 shadow-sm">
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
        <Stat
          label="Needs your attention"
          dot
          value={attention}
          helper={`of ${total} report${total === 1 ? "" : "s"}`}
          action={linkBits.length ? { text: `${linkBits.join(", ")} →`, onClick: onNeedsAction } : undefined}
        />
        <Stat
          label="Ready to send"
          value={approved}
          helper={approved === 1 && approvedName ? `${approvedName} is approved` : `${approved} approved report${approved === 1 ? "" : "s"}`}
        />
        <Stat label="Sent" value={sent} muted={sent === 0} helper={sent === 0 ? "Nothing sent yet this month" : `${sent} this month`} />
        <Stat label="Merchants" value={total} helper={`Active in ${monthLabel}`} />
      </div>

      <div className="flex flex-col gap-2 border-t border-border px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Monthly pipeline</span>
          <span className="text-xs text-muted-foreground">
            <span className="tabular-nums">{approved}</span> of <span className="tabular-nums">{total}</span> ready to send ·{" "}
            <span className="tabular-nums">{sent}</span> sent
          </span>
        </div>

        <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={present.map((k) => `${STATUS_META[k].label} ${counts[k]}`).join(", ") || "Nothing generated yet"}>
          {present.map((k) => (
            <div key={k} className={cn("h-full", STATUS_META[k].bar)} style={{ width: `${((counts[k] ?? 0) / Math.max(total, 1)) * 100}%` }} />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {legend.map((k) => {
              const { Icon, label } = STATUS_META[k];
              return (
                <span key={k} className="flex items-center gap-1.5 text-xs text-foreground">
                  <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                  {label}
                  <strong className="tabular-nums">{counts[k] ?? 0}</strong>
                </span>
              );
            })}
          </div>
          {zero.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ✓ Nothing {zero.map((k) => STATUS_META[k].label.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " or $1")}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  helper,
  dot,
  muted,
  action,
}: {
  label: string;
  value: number;
  helper: string;
  dot?: boolean;
  muted?: boolean;
  action?: { text: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {dot && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
        {label}
      </span>
      <span className={cn("text-2xl font-semibold tabular-nums tracking-[-0.02em]", muted ? "text-muted-foreground" : "text-foreground")}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{helper}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-0.5 w-fit rounded-md text-left text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {action.text}
        </button>
      )}
    </div>
  );
}
