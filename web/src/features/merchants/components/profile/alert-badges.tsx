import { TriangleAlert, FileWarning, Plug, UserSearch, type LucideIcon, Clock, Ban, KeyRound, MapPinOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ProfileAlertSeverity, ProfileAlertType } from "@/features/merchants/types";

/**
 * Severity badge — the platform pattern (Super App §37): colour is never the
 * only signal, so every badge carries an icon and its text label. That is a
 * WCAG requirement (§42), not decoration.
 */
const SEVERITY_STYLES: Record<ProfileAlertSeverity, string> = {
  CRITICAL: "bg-destructive-subtle text-text-destructive",
  HIGH: "bg-destructive-subtle text-text-destructive",
  MEDIUM: "bg-warning-soft text-warning-text",
  LOW: "bg-muted text-muted-foreground",
};

export function AlertSeverityBadge({ severity }: { severity: ProfileAlertSeverity }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.03em]",
        SEVERITY_STYLES[severity],
      )}
    >
      <TriangleAlert className="size-4" aria-hidden />
      {severity.toLowerCase()}
    </span>
  );
}

/** One icon per §6.4 attention state, so the four read apart at a glance. */
export const ALERT_ICONS: Record<ProfileAlertType, LucideIcon> = {
  "profile.incomplete": TriangleAlert,
  "profile.missing_required": UserSearch,
  "profile.missing_files": FileWarning,
  "data.connection_pending": Plug,
  "profile.outdated": Clock,
  "profile.placeholder": Ban,
  "data.connection_expired": KeyRound,
  "data.nap_conflict": MapPinOff,
};
