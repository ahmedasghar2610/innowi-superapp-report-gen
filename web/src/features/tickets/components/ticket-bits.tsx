import { CalendarClock, CircleCheck, Pause, TriangleAlert, CircleX, Timer } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_DOT,
  STATUS_LABEL,
  TYPE_DOT,
  TYPE_LABEL,
  formatDueDate,
  formatDuration,
  initials,
} from "../labels";
import type { PersonRef, TicketPriority, TicketSla, TicketStatus, TicketType } from "../types";

/* Small presentational pieces shared by the list, board, detail and merchant tab. */

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <Badge tone={PRIORITY_TONE[priority]} icon={false}>
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}

export function StatusLabel({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-foreground", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[status])} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Type with its category — inline ("Design · Logo"), or `stacked` with the
 *  category on a second line for narrow table columns. */
export function TypeLabel({
  type,
  category,
  stacked,
}: {
  type: TicketType;
  category?: string | null;
  stacked?: boolean;
}) {
  if (stacked) {
    return (
      <span className="flex min-w-0 flex-col">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
          <span className={cn("size-2 shrink-0 rounded-sm", TYPE_DOT[type])} aria-hidden />
          {TYPE_LABEL[type]}
        </span>
        {category ? <span className="truncate pl-3.5 text-xs text-muted-foreground">{category}</span> : null}
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm">
      <span className={cn("size-2 shrink-0 rounded-sm", TYPE_DOT[type])} aria-hidden />
      <span className="font-medium text-foreground">{TYPE_LABEL[type]}</span>
      {category ? <span className="truncate text-muted-foreground">· {category}</span> : null}
    </span>
  );
}

export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-accent font-semibold text-accent-foreground",
        size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs",
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function PersonChip({ person, emptyLabel = "Unassigned" }: { person: PersonRef | null; emptyLabel?: string }) {
  if (!person) return <span className="text-sm text-text-destructive">{emptyLabel}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2" title={person.email}>
      <Avatar name={person.name} />
      <span className="truncate text-sm text-foreground">{person.name}</span>
    </span>
  );
}

export function DueDate({
  dueDate,
  overdue,
  className,
}: {
  dueDate: string | null;
  overdue: boolean;
  className?: string;
}) {
  if (!dueDate) return <span className={cn("text-sm text-muted-foreground", className)}>—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-sm",
        overdue ? "font-medium text-text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {overdue ? <CalendarClock className="size-3.5" aria-hidden /> : null}
      {formatDueDate(dueDate)}
      {overdue ? <span className="sr-only">(overdue)</span> : null}
    </span>
  );
}

/** "2d 4h left" / "At risk · 6h left" / "Breached 3h" / "Paused" / "Met" —
 *  icon + text, never colour alone. */
export function SlaLabel({ sla, className }: { sla: TicketSla | null; className?: string }) {
  if (!sla) return <span className={cn("text-sm text-muted-foreground", className)}>—</span>;
  const base = "inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0";
  switch (sla.state) {
    case "met":
      return (
        <span className={cn(base, "text-success-subtle-foreground", className)}>
          <CircleCheck aria-hidden />
          Met
        </span>
      );
    case "paused":
      return (
        <span className={cn(base, "text-muted-foreground", className)} title="Clock paused while awaiting the merchant">
          <Pause aria-hidden />
          Paused
        </span>
      );
    case "breached":
      return (
        <span className={cn(base, "text-text-destructive", className)}>
          <CircleX aria-hidden />
          {sla.remainingSeconds < 0 ? `${formatDuration(sla.remainingSeconds)} over` : "Breached"}
        </span>
      );
    case "at_risk":
      return (
        <span className={cn(base, "text-warning-text", className)}>
          <TriangleAlert aria-hidden />
          {formatDuration(sla.remainingSeconds)} left
        </span>
      );
    default:
      return (
        <span className={cn(base, "text-muted-foreground", className)}>
          <Timer aria-hidden />
          {formatDuration(sla.remainingSeconds)} left
        </span>
      );
  }
}
