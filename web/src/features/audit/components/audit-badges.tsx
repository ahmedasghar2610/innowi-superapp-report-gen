import { Badge } from "@/components/ui";
import { auditAction, auditOutcome } from "@/lib/enums";
import { humanize } from "@/lib/format";
import type { AuditAction, AuditOutcome } from "@/features/audit/types";

export function AuditActionBadge({ action }: { action: AuditAction }) {
  const meta = auditAction[action];
  return <Badge tone={meta?.tone ?? "neutral"}>{meta?.label ?? humanize(action)}</Badge>;
}

export function AuditOutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  const meta = auditOutcome[outcome];
  return (
    <Badge tone={meta?.tone ?? "neutral"}>
      {meta?.label ?? humanize(outcome)}
    </Badge>
  );
}
