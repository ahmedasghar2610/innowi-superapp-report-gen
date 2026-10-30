"use client";

import { Drawer } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { AuditActionBadge, AuditOutcomeBadge } from "./audit-badges";
import { AuditDiff } from "./audit-diff";
import type { AuditLog } from "@/features/audit/types";

/** Full detail view for one audit row: what changed, who did it, and the raw request context. */
export function AuditLogDrawer({
  log,
  onClose,
}: {
  log: AuditLog | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={!!log}
      onClose={onClose}
      title={log ? `${log.entityType}${log.entityId ? ` · ${log.entityId}` : ""}` : undefined}
      description={log ? formatDateTime(log.createdAt) : undefined}
      size="md"
    >
      {log ? <AuditLogDetail log={log} /> : null}
    </Drawer>
  );
}

function AuditLogDetail({ log }: { log: AuditLog }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <AuditActionBadge action={log.action} />
        <AuditOutcomeBadge outcome={log.outcome} />
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
          {log.statusCode}
        </span>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">What changed</p>
        <AuditDiff log={log} />
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Actor</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-table">
          <MetaItem label="Name / Email" value={log.actorEmail ?? "System"} />
          <MetaItem label="Role" value={log.actorRole ?? "—"} />
        </dl>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Request</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-table">
          <MetaItem label="Method" value={log.method} />
          <MetaItem label="Path" value={log.path} mono />
          <MetaItem label="IP" value={log.ip ?? "—"} />
          <MetaItem label="Merchant" value={log.merchantId ?? "—"} mono />
        </dl>
        {log.userAgent ? (
          <p className="mt-2.5 truncate text-xs text-muted-foreground" title={log.userAgent}>
            {log.userAgent}
          </p>
        ) : null}
      </div>

      {log.errorMessage ? (
        <div>
          <p className="mb-2 text-xs font-semibold text-foreground">Error</p>
          <p className="rounded-lg bg-destructive-subtle px-3 py-2.5 text-table text-text-destructive">{log.errorMessage}</p>
        </div>
      ) : null}
    </div>
  );
}

function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 truncate text-foreground ${mono ? "font-mono text-xs" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}
