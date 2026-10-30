import { Badge, type BadgeTone } from "@/components/ui";
import { humanize } from "@/lib/format";
import type { AccessCriticality, AccessFlag, AccessStatus } from "@/features/merchants/types";

const CRITICALITY_TONE: Record<AccessCriticality, BadgeTone> = {
  CRITICAL: "danger",
  CRITICAL_COMPLIANCE: "danger",
  HIGH: "warning",
  MEDIUM: "accent",
  LOW: "neutral",
};

const STATUS_TONE: Record<AccessStatus, BadgeTone> = {
  NOT_REQUESTED: "neutral",
  REQUESTED: "warning",
  RECEIVED: "accent",
  VERIFIED: "success",
  FAILED: "danger",
  NA: "neutral",
};

const FLAG_TONE: Record<AccessFlag, BadgeTone> = {
  BLOCKER: "danger",
  OPEN: "warning",
  NONE: "neutral",
};

export function CriticalityBadge({ value }: { value: AccessCriticality }) {
  return <Badge tone={CRITICALITY_TONE[value] ?? "neutral"}>{humanize(value)}</Badge>;
}

export function StatusBadge({ value }: { value: AccessStatus }) {
  return <Badge tone={STATUS_TONE[value] ?? "neutral"}>{humanize(value)}</Badge>;
}

export function FlagBadge({ value }: { value: AccessFlag }) {
  // NONE is unremarkable — render it muted and low-emphasis.
  if (value === "NONE") return <span className="text-xs text-muted-foreground">—</span>;
  return <Badge tone={FLAG_TONE[value] ?? "neutral"}>{humanize(value)}</Badge>;
}
